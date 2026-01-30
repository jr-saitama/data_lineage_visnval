"""
Reconciliation engine - executes validation queries against Oracle.
"""
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import yaml

try:
    import oracledb
except ImportError:
    oracledb = None

try:
    import sqlite3
except ImportError:
    sqlite3 = None

from src.database import get_duckdb_connection
from src.models import ReconContract


def load_recon_contract(dataset: str, metadata_path: str = "./metadata") -> Optional[dict]:
    """Load reconciliation contract for a dataset."""
    dataset_parts = dataset.split(".")
    if len(dataset_parts) >= 2:
        layer = dataset_parts[0].replace("DW_", "").lower()
        name = dataset_parts[-1].lower()
    else:
        return None
    
    recon_path = Path(metadata_path) / "recon" / layer / f"{name}.recon.yaml"
    
    if not recon_path.exists():
        return None
    
    with open(recon_path, 'r') as f:
        return yaml.safe_load(f)



def execute_sqlite_query(query: str, params: dict[str, Any], db_path: str) -> Any:
    """Execute a query against SQLite (with ATTACH support) and return result."""
    if sqlite3 is None:
        raise ImportError("sqlite3 not installed")
    
    # Connect to the main database (or memory if just attaching)
    conn = sqlite3.connect(":memory:")
    cursor = conn.cursor()
    
    try:
        # Attach Silver and Gold databases
        # Assuming db_path points to the "data" directory containing dw_silver.db and dw_gold.db
        data_dir = Path(db_path)
        dw_silver = data_dir / "dw_silver.db"
        dw_gold = data_dir / "dw_gold.db"
        
        if dw_silver.exists():
            cursor.execute(f"ATTACH DATABASE '{dw_silver}' AS DW_SILVER")
        if dw_gold.exists():
            cursor.execute(f"ATTACH DATABASE '{dw_gold}' AS DW_GOLD")
            
        # Convert Oracle-style named parameters (:param) to SQLite style (:param)
        # Luckily sqlite3 supports :param style directly!
        
        cursor.execute(query, params)
        cursor.execute(query, params)
        
        # Get column names
        columns = [description[0] for description in cursor.description] if cursor.description else []
        
        # Limit rows to 10 for safety, but we typically use less for UI
        rows = cursor.fetchmany(10)
        
        # If result is single value (scalar), return it directly for backward compatibility
        # BUT for sample failures we want list.
        # Let's decide based on query structure? No, caller should decide.
        # Actually, previous usage expects a scalar return for `run_validation` comparison.
        # `run_validation` uses it for source_val vs target_val (scalars).
        # validation_reverse_match in api.py uses it to check "any result".
        
        if len(rows) == 1 and len(columns) == 1:
             return rows[0][0]
        elif len(rows) == 0:
             return None
             
        # For multi-row results (failures), return robust structure
        return {"columns": columns, "rows": rows}
    except Exception as e:
        print(f"SQLite execution error: {e}")
        print(f"Query: {query}")
        print(f"Params: {params}")
        raise
    finally:
        conn.close()


def execute_oracle_query(query: str, params: dict[str, Any], connection_string: str) -> Any:
    """Execute a query against Oracle and return result."""
    if oracledb is None:
        raise ImportError("oracledb not installed")
    
    conn = oracledb.connect(connection_string)
    cursor = conn.cursor()
    
    try:
        cursor.execute(query, params)
        result = cursor.fetchone()
        return result[0] if result else None
    finally:
        cursor.close()
        conn.close()


def check_value_match(source_val: Any, target_val: Any, comparison: str = "EXACT_MATCH", tolerance: float = 0.0) -> tuple[bool, Any]:
    """
    Compare source and target values.
    Returns (is_match, difference)
    """
    if comparison == "EXACT_MATCH":
        passed = source_val == target_val
        diff = 0 if passed else "N/A" # No numeric diff for exact match of strings/etc
    elif comparison == "NUMERIC_MATCH":
        try:
            s_val = float(source_val) if source_val is not None else 0.0
            t_val = float(target_val) if target_val is not None else 0.0
            
            if s_val == 0 and t_val == 0:
                diff_pct = 0.0
            else:
                diff_pct = abs(s_val - t_val) / max(abs(s_val), 1) * 100
                
            passed = diff_pct <= (tolerance * 100)
            diff = f"{diff_pct:.2f}%"
        except (ValueError, TypeError):
            passed = False
            diff = "Non-numeric"
    else:
        passed = source_val == target_val
        diff = 0 if passed else "N/A"
        
    return passed, diff


def run_validation(
    dataset: str,
    validation_name: str,
    parameters: dict[str, Any],
    oracle_connection: Optional[str] = None,
    metadata_path: str = "./metadata",
    duckdb_path: str = "./metrics.duckdb"
) -> dict:
    """
    Run a single reconciliation validation.
    
    Returns:
        {
            "status": "PASS" | "FAIL" | "ERROR" | "SKIPPED",
            "source_value": ...,
            "target_value": ...,
            "diff_pct": ...,
            "message": ...
        }
    """
    run_id = str(uuid.uuid4())
    started_at = datetime.utcnow()
    
    # Load contract
    contract = load_recon_contract(dataset, metadata_path)
    if not contract:
        return {"status": "ERROR", "message": "Recon contract not found"}
    
    # Find validation
    validation = None
    for v in contract.get("validations", []):
        if v.get("name") == validation_name:
            validation = v
            break
    
    if not validation:
        return {"status": "ERROR", "message": f"Validation '{validation_name}' not found"}
    
    # Merge default parameters
    # Copy provided parameters to avoid mutating input
    final_params = parameters.copy()
    
    # Check for parameter definitions in the contract (supporting Lineage-style parameters block)
    # The validation object from lineage contract might refer to the field entry which has 'parameters' list
    # But here 'validation' is extracted from 'validations' list in Recon contract OR 'field_lineage' in Lineage contract?
    # Wait, load_recon_contract loads from "recon" folder.
    # If we are validating a Lineage contract, we might be using a different path?
    # The CLI output showed it was validating ORDERS_FACT. 
    # Let's assume validation object has 'parameters' which is a LIST of dicts with 'name' and 'default'
    
    defaults = {}
    if "parameters" in validation and isinstance(validation["parameters"], list):
        for p in validation["parameters"]:
            if "name" in p and "default" in p:
                defaults[p["name"]] = p["default"]
    
    # Apply defaults for missing params
    for k, v in defaults.items():
        if k not in final_params:
            final_params[k] = v
            
    if not oracle_connection and not duckdb_path: # Allow running with just parameters if testing logic
        return {
            "status": "SKIPPED",
            "message": "Start validation: Database connection not configured.",
            "source_query": validation.get("source_query", "")[:500],
            "target_query": validation.get("target_query", "")[:500],
            "parameters": final_params
        }
    
    try:
        # Determine execution engine
        if oracle_connection and oracle_connection.startswith("sqlite://"):
            # Extract path from sqlite://path/to/data
            db_path = oracle_connection.replace("sqlite://", "")
            executor = lambda q, p: execute_sqlite_query(q, p, db_path)
        elif oracle_connection:
            executor = lambda q, p: execute_oracle_query(q, p, oracle_connection)
        else:
            raise ValueError("No valid database connection string provided")

        # Execute source query
        source_value = executor(
            validation["source_query"],
            final_params
        )
        
        # Execute target query
        target_value = executor(
            validation["target_query"],
            final_params
        )
        
        # Compare
        comparison = validation.get("comparison", "EXACT_MATCH")
        tolerance = validation.get("tolerance", 0)
        
        passed, diff = check_value_match(source_value, target_value, comparison, tolerance)
        diff_pct = diff if comparison == "NUMERIC_MATCH" and isinstance(diff, str) and diff.endswith("%") else (0 if passed else 100)
        # diff_pct in DB is float, so lets strip %
        if isinstance(diff_pct, str) and diff_pct.endswith("%"):
             try:
                diff_pct = float(diff_pct.replace("%", ""))
             except:
                diff_pct = 0
        
        status = "PASS" if passed else "FAIL"
        
        result = {
            "status": status,
            "source_value": source_value,
            "target_value": target_value,
            "diff_pct": diff_pct,
            "message": f"Validation {'passed' if passed else 'failed'}"
        }
        
    except Exception as e:
        result = {
            "status": "ERROR",
            "message": str(e)
        }
    
    # Log to DuckDB
    try:
        duck = get_duckdb_connection(duckdb_path)
        duck.execute(
            """
            INSERT INTO recon_runs (run_id, dataset, validation_name, status, source_value, target_value, diff_pct, parameters, started_at, completed_at, error_message)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                run_id,
                dataset,
                validation_name,
                result.get("status"),
                result.get("source_value"),
                result.get("target_value"),
                result.get("diff_pct"),
                str(parameters),
                started_at,
                datetime.utcnow(),
                result.get("message") if result.get("status") == "ERROR" else None
            ]
        )
    except Exception:
        pass  # Non-critical
    
    return result


def run_all_validations(
    dataset: str,
    parameters: dict[str, Any],
    oracle_connection: Optional[str] = None,
    metadata_path: str = "./metadata"
) -> list[dict]:
    """Run all validations for a dataset."""
    contract = load_recon_contract(dataset, metadata_path)
    if not contract:
        return [{"status": "ERROR", "message": "Recon contract not found"}]
    
    results = []
    for validation in contract.get("validations", []):
        result = run_validation(
            dataset,
            validation["name"],
            parameters,
            oracle_connection,
            metadata_path
        )
        result["validation_name"] = validation["name"]
        results.append(result)
    
    return results


def main():
    """CLI for running reconciliation."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Run reconciliation validations")
    parser.add_argument("dataset", help="Dataset name (e.g., DW_GOLD.ORDERS_FACT)")
    parser.add_argument("--validation", help="Specific validation name")
    parser.add_argument("--oracle", help="Oracle connection string")
    parser.add_argument("--metadata", default="./metadata", help="Metadata path")
    parser.add_argument("--params", help="JSON string of parameters (e.g. '{\"start_date\": \"2023-01-01\"}')")
    
    args = parser.parse_args()
    
    import json
    parameters = {}
    if args.params:
        try:
            parameters = json.loads(args.params)
        except json.JSONDecodeError as e:
            print(f"Error parsing params JSON: {e}")
            return

    if args.validation:
        result = run_validation(args.dataset, args.validation, parameters, args.oracle, args.metadata)
        print(f"\n{args.validation}: {result['status']}")
        print(f"  {result.get('message', '')}")
    else:
        results = run_all_validations(args.dataset, parameters, args.oracle, args.metadata)
        print(f"\nReconciliation Results for {args.dataset}:")
        for r in results:
            print(f"  {r.get('validation_name', 'Unknown')}: {r['status']}")


if __name__ == "__main__":
    main()
