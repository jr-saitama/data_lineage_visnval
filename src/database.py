"""
Database initialization and operations for KuzuDB (graph) and DuckDB (metrics).
"""
import kuzu
import duckdb
from pathlib import Path


def init_kuzu_schema(db_path: str = "./kuzu_db") -> kuzu.Connection:
    """Initialize KuzuDB with lineage graph schema."""
    db = kuzu.Database(db_path)
    conn = kuzu.Connection(db)
    
    # Node Tables
    conn.execute("""
        CREATE NODE TABLE IF NOT EXISTS Dataset(
            id STRING,
            name STRING,
            layer STRING,
            domain STRING,
            description STRING,
            PRIMARY KEY(id)
        )
    """)
    
    conn.execute("""
        CREATE NODE TABLE IF NOT EXISTS Field(
            id STRING,
            name STRING,
            data_type STRING,
            nullable BOOL,
            adjustable BOOL,
            PRIMARY KEY(id)
        )
    """)
    
    # Relationship Tables
    conn.execute("CREATE REL TABLE IF NOT EXISTS CONTAINS(FROM Dataset TO Field)")
    conn.execute("CREATE REL TABLE IF NOT EXISTS DEPENDS_ON(FROM Dataset TO Dataset)")
    conn.execute("CREATE REL TABLE IF NOT EXISTS COPIED_FROM(FROM Field TO Field, validation_query STRING)")
    conn.execute("CREATE REL TABLE IF NOT EXISTS LOOKED_UP_FROM(FROM Field TO Field, validation_query STRING)")
    conn.execute("CREATE REL TABLE IF NOT EXISTS CALCULATED_FROM(FROM Field TO Field, validation_query STRING)")
    conn.execute("CREATE REL TABLE IF NOT EXISTS DERIVED_FROM(FROM Field TO Field, validation_query STRING)")
    
    return conn


def init_duckdb_schema(db_path: str = "./metrics.duckdb") -> duckdb.DuckDBPyConnection:
    """Initialize DuckDB with metrics and history schema."""
    conn = duckdb.connect(db_path)
    
    # Reconciliation run history
    conn.execute("""
        CREATE TABLE IF NOT EXISTS recon_runs (
            run_id VARCHAR PRIMARY KEY,
            dataset VARCHAR,
            validation_name VARCHAR,
            status VARCHAR,
            source_value DOUBLE,
            target_value DOUBLE,
            diff_pct DOUBLE,
            parameters JSON,
            started_at TIMESTAMP,
            completed_at TIMESTAMP,
            error_message VARCHAR
        )
    """)
    
    # Field validation history
    conn.execute("""
        CREATE TABLE IF NOT EXISTS validation_history (
            id VARCHAR PRIMARY KEY,
            dataset VARCHAR,
            field VARCHAR,
            lineage_type VARCHAR,
            mismatched_count INTEGER,
            total_count INTEGER,
            match_pct DOUBLE,
            parameters JSON,
            run_at TIMESTAMP
        )
    """)
    
    # Contract change log
    conn.execute("""
        CREATE TABLE IF NOT EXISTS contract_changes (
            id VARCHAR PRIMARY KEY,
            contract_type VARCHAR,
            contract_path VARCHAR,
            action VARCHAR,
            changed_by VARCHAR,
            changed_at TIMESTAMP,
            version INTEGER,
            commit_message VARCHAR
        )
    """)
    
    # Daily aggregated metrics
    conn.execute("""
        CREATE TABLE IF NOT EXISTS daily_metrics (
            date DATE,
            dataset VARCHAR,
            total_validations INTEGER,
            pass_count INTEGER,
            fail_count INTEGER,
            avg_match_pct DOUBLE,
            PRIMARY KEY (date, dataset)
        )
    """)
    
    return conn


_kuzu_db = None

def get_kuzu_connection(db_path: str = "./kuzu_db") -> kuzu.Connection:
    """Get a connection to KuzuDB, reusing the database instance."""
    global _kuzu_db
    if _kuzu_db is None:
        _kuzu_db = kuzu.Database(db_path)
    return kuzu.Connection(_kuzu_db)


def get_duckdb_connection(db_path: str = "./metrics.duckdb") -> duckdb.DuckDBPyConnection:
    """Get a connection to DuckDB."""
    return duckdb.connect(db_path)
