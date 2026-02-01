"""
FastAPI server for Data Lineage & Reconciliation System.
"""
import uuid
from datetime import datetime
from pathlib import Path
import traceback
from typing import Any, Optional

import yaml
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from src.database import get_kuzu_connection, get_duckdb_connection, init_kuzu_schema, init_duckdb_schema
from src.models import DatasetContract, LineageContract, ReconContract


from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Startup: Triggering metadata ingestion...")
    try:
        from src.ingest import ingest_all_contracts
        # Run ingestion
        ingest_all_contracts(metadata_path=str(METADATA_PATH), db_path=KUZU_PATH)
        print("Startup: Ingestion complete.")
    except Exception as e:
        print(f"Startup warning: Ingestion failed: {e}")
        traceback.print_exc()
    yield

app = FastAPI(
    title="Data Lineage API",
    description="API for Data Lineage & Reconciliation System",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
METADATA_PATH = Path("./metadata")
DRAFTS_PATH = Path("./metadata_drafts")
KUZU_PATH = "./kuzu_db"
DUCKDB_PATH = "./metrics.duckdb"


# Use ruamel.yaml for better multi-line string handling
from ruamel.yaml import YAML
from ruamel.yaml.scalarstring import LiteralScalarString


def _convert_multiline_strings(obj):
    """Recursively convert multi-line strings to LiteralScalarString for block scalar output."""
    if isinstance(obj, dict):
        return {k: _convert_multiline_strings(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_convert_multiline_strings(item) for item in obj]
    elif isinstance(obj, str) and '\n' in obj:
        return LiteralScalarString(obj)
    return obj


# Helper function for consistent YAML dumping
def dump_yaml(data, stream):
    """Dump YAML with proper multi-line string formatting using ruamel.yaml."""
    # Convert multi-line strings to LiteralScalarString for block scalar output
    converted_data = _convert_multiline_strings(data)
    
    # Create ruamel.yaml instance with proper settings
    yaml_dumper = YAML()
    yaml_dumper.default_flow_style = False
    yaml_dumper.allow_unicode = True
    yaml_dumper.width = 4096  # Prevent line wrapping
    
    yaml_dumper.dump(converted_data, stream)


# =============================================================================
# Request/Response Models
# =============================================================================
class DraftSubmitRequest(BaseModel):
    commit_message: str


class ValidationRequest(BaseModel):
    dataset: str
    fields: Optional[list[str]] = None
    parameters: dict[str, Any] = {}


class ReconExecuteRequest(BaseModel):
    dataset: str
    validation_name: str
    parameters: dict[str, Any] = {}


class ContractSaveRequest(BaseModel):
    content: dict
    commit_message: str


# =============================================================================
# Dataset Endpoints
# =============================================================================
@app.get("/datasets")
def list_datasets():
    """List all datasets."""
    conn = get_kuzu_connection(KUZU_PATH)
    result = conn.execute("MATCH (d:Dataset) RETURN d.id, d.name, d.layer, d.domain")
    
    datasets = []
    while result.has_next():
        row = result.get_next()
        datasets.append({
            "id": row[0],
            "name": row[1],
            "layer": row[2],
            "domain": row[3]
        })
    
    return {"datasets": datasets}


@app.get("/search")
def search(q: str, search_type: str = "all"):
    """Search datasets and fields with fuzzy matching.
    
    Args:
        q: Search query
        search_type: 'dataset', 'field', or 'all'
    """
    from difflib import SequenceMatcher
    
    def fuzzy_score(query: str, text: str) -> float:
        """Calculate fuzzy match score (0-1)."""
        query = query.lower()
        text = text.lower()
        # Exact match
        if query in text:
            return 1.0
        # Sequence matching
        return SequenceMatcher(None, query, text).ratio()
    
    results = []
    conn = get_kuzu_connection(KUZU_PATH)
    
    if search_type in ("all", "dataset"):
        result = conn.execute("MATCH (d:Dataset) RETURN d.id, d.name, d.layer, d.domain")
        while result.has_next():
            row = result.get_next()
            score = max(fuzzy_score(q, row[0]), fuzzy_score(q, row[1]))
            if score > 0.3:  # Minimum threshold
                results.append({
                    "type": "dataset",
                    "id": row[0],
                    "name": row[1],
                    "layer": row[2],
                    "domain": row[3],
                    "score": round(score, 3)
                })
    
    if search_type in ("all", "field"):
        result = conn.execute("""
            MATCH (d:Dataset)-[:CONTAINS]->(f:Field)
            RETURN f.id, f.name, d.id, d.name
        """)
        while result.has_next():
            row = result.get_next()
            score = max(fuzzy_score(q, row[0]), fuzzy_score(q, row[1]))
            if score > 0.3:
                results.append({
                    "type": "field",
                    "id": row[0],
                    "name": row[1],
                    "datasetId": row[2],
                    "datasetName": row[3],
                    "score": round(score, 3)
                })
    
    # Sort by score descending
    results.sort(key=lambda x: x["score"], reverse=True)
    
    return {"results": results[:50], "query": q}


@app.get("/datasets/{dataset_id}/fields")
def get_dataset_fields(dataset_id: str):
    """Get fields for a dataset."""
    conn = get_kuzu_connection(KUZU_PATH)
    result = conn.execute(
        """
        MATCH (d:Dataset {id: $id})-[:CONTAINS]->(f:Field)
        RETURN f.id, f.name, f.data_type, f.nullable, f.adjustable
        """,
        {"id": dataset_id}
    )
    
    fields = []
    while result.has_next():
        row = result.get_next()
        fields.append({
            "id": row[0],
            "name": row[1],
            "data_type": row[2],
            "nullable": row[3],
            "adjustable": row[4]
        })
    
    return {"dataset_id": dataset_id, "fields": fields}


# =============================================================================
# Lineage Endpoints
# =============================================================================
@app.get("/lineage/{dataset_id}")
def get_lineage(dataset_id: str, level: str = "field"):
    """Get lineage graph for a dataset (React Flow format).
    
    Args:
        dataset_id: The dataset identifier
        level: 'dataset' for high-level view, 'field' for granular view
    """
    conn = get_kuzu_connection(KUZU_PATH)
    
    nodes = []
    edges = []
    source_datasets = {}  # Track source datasets and their fields
    
    # Get target dataset info
    result = conn.execute(
        "MATCH (d:Dataset {id: $id}) RETURN d.id, d.name, d.layer, d.domain, d.description",
        {"id": dataset_id}
    )
    
    target_dataset = None
    if result.has_next():
        row = result.get_next()
        target_dataset = {
            "id": row[0],
            "name": row[1],
            "layer": row[2],
            "domain": row[3],
            "description": row[4]
        }
    
    if not target_dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    # Load dataset contract metadata
    ds_meta = {}
    ds_contract = {}
    try:
        dataset_parts = target_dataset["name"].split(".")
        if len(dataset_parts) >= 2:
            layer = dataset_parts[0].replace("DW_", "").lower()
            name = dataset_parts[-1].lower()
            ds_path = METADATA_PATH / "datasets" / layer / f"{name}.yaml"
            if ds_path.exists():
                with open(ds_path, 'r', encoding='utf-8') as f:
                    ds_contract = yaml.safe_load(f)
                    ds_meta = ds_contract.get("dataset", {})
    except Exception:
        pass
    
    # Extract fields definitions from contract (support both 'fields' and 'schema' at root or inside dataset)
    contract_fields = ds_contract.get("fields") or ds_contract.get("schema") or ds_meta.get("fields") or []
    
    if level == "dataset":
        # Dataset-level lineage: show only dataset dependencies
        # Load lineage contract to get dependencies
        dataset_parts = dataset_id.split(".")
        if len(dataset_parts) >= 2:
            layer = dataset_parts[0].replace("DW_", "").lower()
            name = dataset_parts[-1].lower()
        else:
            layer = "gold"
            name = dataset_id.lower()
        
        lineage_path = METADATA_PATH / "lineage" / layer / f"{name}.lineage.yaml"
        
        dependencies = []
        if lineage_path.exists():
            with open(lineage_path, 'r') as f:
                lineage = yaml.safe_load(f)
                dependencies = lineage.get("dataset_dependencies", [])
        
        # Also check DEPENDS_ON relationships in graph
        result = conn.execute(
            """
            MATCH (d:Dataset {id: $id})-[:DEPENDS_ON]->(s:Dataset)
            RETURN s.id, s.name, s.layer
            """,
            {"id": dataset_id}
        )
        
        while result.has_next():
            row = result.get_next()
            if row[0] not in dependencies:
                dependencies.append(row[0])
        
        # Position: sources on left, target on right
        y_pos = 100
        y_spacing = 80
        
        for i, dep in enumerate(dependencies):
            # Resolve short names (e.g. "ORDERS") to full IDs (e.g. "DW_SILVER.ORDERS")
            if "." not in dep:
                # 1. Try to find a matching dataset in the graph
                candidates = conn.execute(
                    "MATCH (d:Dataset) WHERE d.name = $name OR d.id ENDS WITH '.' + $name RETURN d.id LIMIT 1",
                    {"name": dep}
                )
                if candidates.has_next():
                    dep = candidates.get_next()[0]
                else:
                    # 2. Fallback: Search in metadata files
                    # We don't know the layer, so check all layers
                    try:
                        found_path = None
                        found_layer = None
                        
                        # Iterate over layer directories in ./metadata/datasets
                        datasets_dir = METADATA_PATH / "datasets"
                        if datasets_dir.exists():
                           for layer_dir in datasets_dir.iterdir():
                               if layer_dir.is_dir():
                                   possible_file = layer_dir / f"{dep.lower()}.yaml"
                                   if possible_file.exists():
                                       found_path = possible_file
                                       found_layer = layer_dir.name
                                       break
                        
                        if found_path:
                            with open(found_path, 'r', encoding='utf-8') as f:
                                c = yaml.safe_load(f)
                                full_name = c.get("dataset", {}).get("name")
                                if full_name:
                                    dep = full_name
                    except Exception as e:
                        print(f"Error resolving dependency {dep}: {e}")
            
            
            dep_name = dep.split(".")[-1] if "." in dep else dep
            
            # Load metadata for source dataset
            src_meta = {}
            src_pk = None
            try:
                parts = dep.split(".")
                if len(parts) >= 2:
                    l = parts[0].replace("DW_", "").lower()
                    n = parts[-1].lower()
                    p = METADATA_PATH / "datasets" / l / f"{n}.yaml"
                    if p.exists():
                        with open(p, 'r', encoding='utf-8') as f:
                            c = yaml.safe_load(f)
                            src_meta = c.get("dataset", {})
                            src_pk = c.get("primary_key")
            except Exception:
                pass

            nodes.append({
                "id": dep,
                "type": "source_dataset",
                "data": {
                    "label": dep, # Show full ID (e.g. DW_SILVER.ORDERS)
                    "fullName": dep,
                    "layer": dep.split(".")[0] if "." in dep else "UNKNOWN",
                    "description": src_meta.get("description"),
                    "domain": src_meta.get("domain"),
                    "owner": src_meta.get("owner"),
                    "primary_keys": src_pk
                },
                "position": {"x": 100, "y": y_pos + (i * y_spacing)}
            })
            edges.append({
                "id": f"e-{dep}-{dataset_id}",
                "source": dep,
                "target": dataset_id,
                "type": "depends_on",
                "animated": True
            })
        
        # Target dataset on the right

        nodes.append({
            "id": target_dataset["id"],
            "type": "target_dataset",
            "data": {
                "label": target_dataset["name"],
                "layer": target_dataset["layer"],
                "domain": target_dataset["domain"],
                "description": target_dataset["description"],
                "owner": ds_meta.get("owner"),
                "classification": ds_meta.get("classification"),
                "type": ds_meta.get("type"),
                "tags": ds_meta.get("tags"),
                "primary_keys": ds_contract.get("primary_key")
            },
            "position": {"x": 600, "y": 100 + (len(dependencies) * y_spacing // 2) - 40}
        })
        
    else:
        # Field-level lineage: show detailed field mappings
        # Get target fields with full metadata
        result = conn.execute(
            """
            MATCH (d:Dataset {id: $id})-[:CONTAINS]->(f:Field)
            RETURN f.id, f.name, f.data_type, f.nullable, f.adjustable
            """,
            {"id": dataset_id}
        )
        
        target_fields = []
        while result.has_next():
            row = result.get_next()
            target_fields.append({
                "id": row[0],
                "name": row[1],
                "data_type": row[2],
                "nullable": row[3],
                "adjustable": row[4]
            })
        
        # Get lineage relationships and organize by source dataset
        field_lineage_info = {}  # field_id -> lineage info
        
        for rel_type in ["COPIED_FROM", "LOOKED_UP_FROM", "CALCULATED_FROM", "DERIVED_FROM"]:
            result = conn.execute(
                f"""
                MATCH (d:Dataset {{id: $id}})-[:CONTAINS]->(f:Field)-[r:{rel_type}]->(s:Field)
                RETURN f.id, f.name, s.id, s.name, '{rel_type}', r.validation_query
                """,
                {"id": dataset_id}
            )
            
            while result.has_next():
                row = result.get_next()
                target_field_id = row[0]
                source_field_id = row[2]
                source_parts = source_field_id.rsplit(".", 1)
                source_dataset = source_parts[0] if len(source_parts) > 1 else "UNKNOWN"
                
                # Track source datasets
                if source_dataset not in source_datasets:
                    source_datasets[source_dataset] = []
                if source_field_id not in [f["id"] for f in source_datasets[source_dataset]]:
                    source_datasets[source_dataset].append({
                        "id": source_field_id,
                        "name": row[3] or source_field_id.split(".")[-1]
                    })
                
                # Track lineage info for target field
                if target_field_id not in field_lineage_info:
                    field_lineage_info[target_field_id] = {
                        "type": rel_type,
                        "sources": [],
                        "validation_query": row[5]
                    }
                field_lineage_info[target_field_id]["sources"].append({
                    "field_id": source_field_id,
                    "field_name": row[3],
                    "dataset": source_dataset
                })
        
        # Load parameters from contract YAML to enrich node data
        field_params = {}
        try:
            dataset_parts = dataset_id.split(".")
            if len(dataset_parts) >= 2:
                layer = dataset_parts[0].replace("DW_", "").lower()
                name = dataset_parts[-1].lower()
            else:
                layer = "gold"
                name = dataset_id.lower()
            
            lineage_path = METADATA_PATH / "lineage" / layer / f"{name}.lineage.yaml"
            if lineage_path.exists():
                with open(lineage_path, 'r', encoding='utf-8') as f:
                    lineage = yaml.safe_load(f)
                    for item in lineage.get("field_lineage", []):
                        field_name = item.get("field")
                        params = item.get("parameters", [])
                        if field_name and params:
                            field_params[field_name] = params
        except Exception:
            pass # Fail silently on parameter loading, core graph is priority

        # Calculate positions: sources left, target right
        # Group source fields by dataset
        x_source = 50
        y_pos = 50
        y_spacing = 60
        
        for dataset_name, fields in source_datasets.items():
            ds_short = dataset_name.split(".")[-1] if "." in dataset_name else dataset_name
            
            # Try to load source dataset metadata
            src_meta = {}
            src_pk = None
            try:
                parts = dataset_name.split(".")
                if len(parts) >= 2:
                    l = parts[0].replace("DW_", "").lower()
                    n = parts[-1].lower()
                    p = METADATA_PATH / "datasets" / l / f"{n}.yaml"
                    if p.exists():
                        with open(p, 'r', encoding='utf-8') as f:
                            c = yaml.safe_load(f)
                            src_meta = c.get("dataset", {})
                            src_pk = c.get("primary_key")
                            src_fields = c.get("fields") or c.get("schema", [])
                            
                            src_field_map = {}
                            for f in src_fields:
                                src_field_map[f["name"]] = f
                            src_pk = c.get("primary_key")
            except Exception:
                pass

            # Add dataset header node
            nodes.append({
                "id": f"ds-{dataset_name}",
                "type": "source_dataset",
                "data": {
                    "label": dataset_name,
                    "fullName": dataset_name,
                    "isHeader": True,
                    "description": src_meta.get("description"),
                    "primary_keys": src_pk,
                    "domain": src_meta.get("domain"),
                    "owner": src_meta.get("owner")
                },
                "position": {"x": x_source, "y": y_pos}
            })
            y_pos += 40
            
            for field in fields:
                f_data = src_field_map.get(field["name"], {}) if 'src_field_map' in locals() else {}

                nodes.append({
                    "id": field["id"],
                    "type": "source_field",
                    "data": {
                        "label": field["name"],
                        "dataset": dataset_name,
                        "description": f_data.get("description"),
                        "data_type": f_data.get("data_type") or f_data.get("type"),
                        "nullable": f_data.get("nullable"),
                        "sample_values": f_data.get("sample_values"),
                        "valid_values": f_data.get("valid_values")
                    },
                    "position": {"x": x_source + 20, "y": y_pos}
                })
                y_pos += y_spacing
            
            y_pos += 30  # Extra spacing between datasets
        
        # Target dataset and fields on the right
        x_target = 550
        y_target = 50
        
        nodes.append({
            "id": target_dataset["id"],
            "type": "target_dataset",
            "data": {
                "label": target_dataset["name"],
                "layer": target_dataset["layer"],
                "domain": target_dataset["domain"],
                "description": target_dataset["description"],
                "fieldCount": len(target_fields)
            },
            "position": {"x": x_target, "y": y_target}
        })
        y_target += 60
        
        for field in target_fields:
            # Find field metadata in contract
            field_meta = {}
            if contract_fields:
                for f in contract_fields:
                    if f.get("name") == field["name"]:
                        field_meta = f
                        break
            
            lineage_info = field_lineage_info.get(field["id"], {})
            nodes.append({
                "id": field["id"],
                "type": "target_field",
                "data": {
                    "label": field["name"],
                    "data_type": field["data_type"],
                    "nullable": field["nullable"],
                    "adjustable": field["adjustable"],
                    "description": field_meta.get("description"),
                    "sample_values": field_meta.get("sample_values"),
                    "valid_values": field_meta.get("valid_values"),
                    "lineageType": lineage_info.get("type"),
                    "sources": lineage_info.get("sources", []),
                    "lineageType": lineage_info.get("type"),
                    "sources": lineage_info.get("sources", []),
                    "hasValidation": bool(lineage_info.get("validation_query")),
                    "validationQuery": lineage_info.get("validation_query"),
                    "parameters": field_params.get(field["name"], [])
                },
                "position": {"x": x_target + 20, "y": y_target}
            })
            
            # Add edges from source fields to this target field
            for source in lineage_info.get("sources", []):
                edges.append({
                    "id": f"e-{source['field_id']}-{field['id']}",
                    "source": source["field_id"],
                    "target": field["id"],
                    "type": lineage_info.get("type", "unknown").lower(),
                    "animated": True,
                    "data": {
                        "lineageType": lineage_info.get("type"),
                        "hasValidation": bool(lineage_info.get("validation_query"))
                    }
                })
            
            y_target += y_spacing
    
    return {"nodes": nodes, "edges": edges, "level": level}


@app.get("/lineage/field/{field_id}")
def get_field_upstream_lineage(field_id: str):
    """Get immediate upstream lineage for a specific field (Drill-down)."""
    try:
        conn = get_kuzu_connection(KUZU_PATH)
        
        # Check if field exists
        if not conn.execute("MATCH (f:Field {id: $id}) RETURN f.id", {"id": field_id}).has_next():
           raise HTTPException(status_code=404, detail="Field not found")

        # Find upstream fields: (field)-[backwards]-(upstream)
        # We assume direction is Source -> Target, so Upstream -> ClickedNode
        # Ingestion creates: (Target Field)-[REL]->(Source Field) for 'copied_from' etc.
        # Wait, let's verify direction in Step 107 (ingest.py):
        # CREATE (t)-[:{rel_type} ...]->(s)
        # t=Target, s=Source.
        # So Target -> Source.
        # So to find upstream source for 'field_id' (which is the target), we match:
        # (f:Field {id: field_id})-[r]->(s:Field)
        
        # NOTE: Kuzu `type(r)` function might be failing or returning something unexpected.
        # We will return `r` and getting label from it, or use `label(r)` if supported?
        # Safe bet: return `r` and access `r.label` if using python API, assuming `r` is an object?
        # Kuzu python result `get_next()` returns values. Relationship in Kuzu result?
        # Actually `label(r)` is the function in OpenCypher/Kuzu usually if `type` failed.
        # But safest is `RETURN *, label(r)`?
        # Let's try `label(r)` instead of `type(r)`. Documentation says `label(r)`.
        
        result = conn.execute(
            """
            MATCH (f:Field {id: $id})-[r]->(s:Field)
            RETURN s.id, s.name, label(r), r.validation_query
            """,
            {"id": field_id}
        )
        
        nodes = []
        edges = []
        source_datasets = {} # dataset_name -> [fields]
        
        while result.has_next():
            row = result.get_next()
            source_id = row[0]
            source_name = row[1]
            rel_type = row[2] # Now using label(r)
            val_query = row[3]
            
            # Extract dataset info
            parts = source_id.rsplit(".", 1)
            ds_name = parts[0] if len(parts) > 1 else "UNKNOWN"
            
            if ds_name not in source_datasets:
                source_datasets[ds_name] = []
            
            source_datasets[ds_name].append({
                "id": source_id,
                "name": source_name,
                "rel_type": rel_type,
                "val_query": val_query
            })

        # Build nodes for new sources
        for ds_name, fields in source_datasets.items():
            # Load dataset metadata
            ds_meta = {}
            ds_pk = None
            fields_list = []
            try:
                parts = ds_name.split(".")
                if len(parts) >= 2:
                    prefix = parts[0]
                    n = parts[-1].lower()
                    
                    if prefix == "SRC_SYSTEM":
                        l = "source"
                    else:
                        l = prefix.replace("DW_", "").lower()
                        
                    p = METADATA_PATH / "datasets" / l / f"{n}.yaml"
                    if p.exists():
                        with open(p, 'r', encoding='utf-8') as f:
                            c = yaml.safe_load(f)
                            ds_meta = c.get("dataset", {})
                            ds_pk = c.get("primary_key")
                            fields_list = c.get("fields") or c.get("schema", [])
            except Exception as e:
                print(f"Error loading metadata for {ds_name}: {e}")
                pass
                
            # Dataset Header Node
            ds_short = ds_name.split(".")[-1] if "." in ds_name else ds_name
            nodes.append({
                "id": f"ds-{ds_name}",
                "type": "source_dataset",
                "data": {
                    "label": ds_name,
                    "fullName": ds_name,
                    "isHeader": True,
                    "description": ds_meta.get("description"),
                    "primary_keys": ds_pk,
                    "domain": ds_meta.get("domain"),
                    "owner": ds_meta.get("owner"),
                    "drillDown": True # Marker for frontend layout
                }
            })
            
            # Field Nodes
            # Create a lookup for field metadata
            field_meta_map = {}
            for f in fields_list:
                 field_meta_map[f["name"]] = f

            for field in fields:
                f_data = field_meta_map.get(field["name"], {})
                
                nodes.append({
                    "id": field["id"],
                    "type": "source_field",
                    "data": {
                        "label": field["name"],
                        "dataset": ds_name,
                        "originalType": "source_field",
                        "description": f_data.get("description"),
                        "data_type": f_data.get("data_type") or f_data.get("type"),
                        "nullable": f_data.get("nullable"),
                        "sample_values": f_data.get("sample_values"),
                        "valid_values": f_data.get("valid_values")
                    }
                })
                
                # Edge: NewSource -> ClickedNode
                # Wait, earlier we determined ClickedNode is Target. NewSource is Source.
                # ReactFlow direction: Source -> Target.
                # So e.source = NewSource, e.target = ClickedNode
                # Correct.
                
                edges.append({
                    "id": f"e-{field['id']}-{field_id}",
                    "source": field["id"],
                    "target": field_id,
                    "type": field["rel_type"].lower(), # copied_from
                    "animated": True,
                    "data": {
                        "hasValidation": bool(field["val_query"])
                    }
                })

        return {"nodes": nodes, "edges": edges}
    except Exception as e:
        print(f"Error in get_field_upstream_lineage: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# Contract Editor Endpoints
# =============================================================================
@app.get("/contracts")
def list_contracts():
    """List all contracts (datasets, lineage, recon)."""
    contracts = []
    
    try:
        # Scan all contract directories
        for contract_type, subdir, suffix in [
            ("dataset", "datasets", ".yaml"),
            ("lineage", "lineage", ".lineage.yaml"),
            ("recon", "recon", ".recon.yaml")
        ]:
            base_path = METADATA_PATH / subdir
            if base_path.exists():
                for layer_dir in base_path.iterdir():
                    if layer_dir.is_dir():
                        for file in layer_dir.glob(f"*{suffix}"):
                            try:
                                with open(file, 'r', encoding='utf-8') as f:
                                    content = yaml.safe_load(f)
                                    if not content: continue # Skip empty files
                                    
                                    name = file.stem.replace(".lineage", "").replace(".recon", "")
                                    contracts.append({
                                        "type": contract_type,
                                        "layer": layer_dir.name,
                                        "name": name,
                                        "path": str(file),
                                        "version": content.get("version", 1),
                                        "target": content.get("dataset", {}).get("name") or content.get("target")
                                    })
                            except Exception as e:
                                print(f"Error loading contract {file}: {e}")
                                traceback.print_exc()
                                pass
    except Exception as e:
        print(f"Error in list_contracts: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
    
    return {"contracts": contracts}



class ContractValidationRequest(BaseModel):
    contract_type: str
    content: str  # YAML string


@app.post("/contracts/validate")
def validate_contract(request: ContractValidationRequest):
    """Validate a contract's YAML syntax and required fields."""
    errors = []
    
    # Step 1: Validate YAML syntax
    try:
        content = yaml.safe_load(request.content)
        if not isinstance(content, dict):
            errors.append("Content must be a valid YAML object/dictionary")
            return {"valid": False, "errors": errors}
    except yaml.YAMLError as e:
        errors.append(f"YAML syntax error: {str(e)}")
        return {"valid": False, "errors": errors}
    
    # Step 2: Validate required fields based on contract type
    if request.contract_type == "dataset":
        if "dataset" not in content:
            errors.append("Missing required field: 'dataset'")
        else:
            if "name" not in content.get("dataset", {}):
                errors.append("Missing required field: 'dataset.name'")
            if "layer" not in content.get("dataset", {}):
                errors.append("Missing required field: 'dataset.layer'")
    
    elif request.contract_type == "lineage":
        if "target" not in content:
            errors.append("Missing required field: 'target'")
        if "field_lineage" not in content:
            errors.append("Missing required field: 'field_lineage'")
        elif not isinstance(content.get("field_lineage"), list):
            errors.append("'field_lineage' must be a list")
    
    elif request.contract_type == "recon":
        if "target" not in content:
            errors.append("Missing required field: 'target'")
        if "validations" not in content:
            errors.append("Missing required field: 'validations'")
    
    else:
        errors.append(f"Invalid contract type: {request.contract_type}")
    
    return {"valid": len(errors) == 0, "errors": errors}


@app.post("/contracts/{contract_type}")
def create_contract(contract_type: str, request: ContractSaveRequest):
    """Create a new contract with required commit message."""
    content = request.content
    commit_message = request.commit_message
    
    if not commit_message or not commit_message.strip():
        raise HTTPException(status_code=400, detail="Commit message is required")
    
    if contract_type == "dataset":
        target = content.get("dataset", {}).get("name", "unknown")
        layer = content.get("dataset", {}).get("layer", "unknown").lower()
        target_path = METADATA_PATH / "datasets" / layer / f"{target.split('.')[-1].lower()}.yaml"
    elif contract_type == "lineage":
        target = content.get("target", "unknown")
        layer = target.split(".")[0].replace("DW_", "").lower()
        target_path = METADATA_PATH / "lineage" / layer / f"{target.split('.')[-1].lower()}.lineage.yaml"
    elif contract_type == "recon":
        target = content.get("target", "unknown")
        layer = target.split(".")[0].replace("DW_", "").lower()
        target_path = METADATA_PATH / "recon" / layer / f"{target.split('.')[-1].lower()}.recon.yaml"
    else:
        raise HTTPException(status_code=400, detail="Invalid contract type")
    
    if target_path.exists():
        raise HTTPException(status_code=409, detail="Contract already exists. Use PUT to update.")
    
    # Set initial version
    content["version"] = 1
    content["meta_version"] = "2.0"
    content["change_history"] = [{
        "version": 1,
        "date": datetime.utcnow().isoformat(),
        "author": "user",
        "message": commit_message
    }]
    
    target_path.parent.mkdir(parents=True, exist_ok=True)
    with open(target_path, 'w') as f:
        dump_yaml(content, f)
    
    # Log to DuckDB
    try:
        duck = get_duckdb_connection(DUCKDB_PATH)
        duck.execute(
            """
            INSERT INTO contract_changes (id, contract_type, contract_path, action, changed_by, changed_at, version, commit_message)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [str(uuid.uuid4()), contract_type, str(target_path), "create", "user", datetime.utcnow(), 1, commit_message]
        )
    except Exception:
        pass
    
    return {"status": "created", "path": str(target_path)}


@app.put("/contracts/{contract_type}/{layer}/{name}")
def update_contract(contract_type: str, layer: str, name: str, request: ContractSaveRequest):
    """Update an existing contract with required commit message."""
    content = request.content
    commit_message = request.commit_message
    
    if not commit_message or not commit_message.strip():
        raise HTTPException(status_code=400, detail="Commit message is required")
    
    if contract_type == "dataset":
        file_path = METADATA_PATH / "datasets" / layer / f"{name}.yaml"
    elif contract_type == "lineage":
        file_path = METADATA_PATH / "lineage" / layer / f"{name}.lineage.yaml"
    elif contract_type == "recon":
        file_path = METADATA_PATH / "recon" / layer / f"{name}.recon.yaml"
    else:
        raise HTTPException(status_code=400, detail="Invalid contract type")
    
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Contract not found. Use POST to create.")
    
    # Load existing to get version
    with open(file_path, 'r') as f:
        existing = yaml.safe_load(f)
    
    # Increment version
    new_version = existing.get("version", 0) + 1
    content["version"] = new_version
    content["meta_version"] = content.get("meta_version", "2.0")
    
    # Update change history
    history = existing.get("change_history", [])
    history.append({
        "version": new_version,
        "date": datetime.utcnow().isoformat(),
        "author": "user",
        "message": commit_message
    })
    content["change_history"] = history
    
    with open(file_path, 'w') as f:
        dump_yaml(content, f)
    
    # Log to DuckDB
    try:
        duck = get_duckdb_connection(DUCKDB_PATH)
        duck.execute(
            """
            INSERT INTO contract_changes (id, contract_type, contract_path, action, changed_by, changed_at, version, commit_message)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [str(uuid.uuid4()), contract_type, str(file_path), "modify", "user", datetime.utcnow(), new_version, commit_message]
        )
    except Exception:
        pass
    
    return {"status": "updated", "path": str(file_path), "version": new_version}





@app.get("/contracts/{contract_type}/{layer}/{name}")
def get_contract(contract_type: str, layer: str, name: str):
    """Get a contract (draft or committed)."""
    # Check for draft first
    draft_path = DRAFTS_PATH / f"{layer}_{name}_{contract_type}.draft.yaml"
    if draft_path.exists():
        with open(draft_path, 'r') as f:
            return {"source": "draft", "content": yaml.safe_load(f)}
    
    # Fall back to committed
    if contract_type == "dataset":
        file_path = METADATA_PATH / "datasets" / layer / f"{name}.yaml"
    elif contract_type == "lineage":
        file_path = METADATA_PATH / "lineage" / layer / f"{name}.lineage.yaml"
    elif contract_type == "recon":
        file_path = METADATA_PATH / "recon" / layer / f"{name}.recon.yaml"
    else:
        raise HTTPException(status_code=400, detail="Invalid contract type")
    
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Contract not found")
    
    with open(file_path, 'r') as f:
        return {"source": "committed", "content": yaml.safe_load(f)}


class DraftSaveRequest(BaseModel):
    content: dict
    original_path: Optional[str] = None


@app.post("/contracts/{contract_type}/draft")
def save_draft(contract_type: str, request: DraftSaveRequest):
    """Save a contract as draft."""
    DRAFTS_PATH.mkdir(parents=True, exist_ok=True)
    
    content = request.content
    draft_id = str(uuid.uuid4())[:8]
    draft_file = DRAFTS_PATH / f"{draft_id}_{contract_type}.draft.yaml"
    
    draft_content = {
        "_draft_meta": {
            "draft_id": draft_id,
            "contract_type": contract_type,
            "created_at": datetime.utcnow().isoformat(),
            "action": "create" if not content.get("version") else "modify",
            "original_path": request.original_path
        },
        **content
    }
    
    with open(draft_file, 'w') as f:
        dump_yaml(draft_content, f)
    
    return {"draft_id": draft_id, "path": str(draft_file)}


@app.get("/contracts/drafts")
def list_drafts():
    """List all drafts."""
    DRAFTS_PATH.mkdir(parents=True, exist_ok=True)
    
    drafts = []
    for draft_file in DRAFTS_PATH.glob("*.draft.yaml"):
        with open(draft_file, 'r') as f:
            content = yaml.safe_load(f)
            if "_draft_meta" in content:
                drafts.append(content["_draft_meta"])
    
    return {"drafts": drafts}


@app.post("/contracts/draft/{draft_id}/submit")
def submit_draft(draft_id: str, request: DraftSubmitRequest):
    """Submit a draft (increment version, add history, save to metadata)."""
    draft_file = None
    for f in DRAFTS_PATH.glob(f"{draft_id}_*.draft.yaml"):
        draft_file = f
        break
    
    if not draft_file:
        raise HTTPException(status_code=404, detail="Draft not found")
    
    with open(draft_file, 'r') as f:
        content = yaml.safe_load(f)
    
    meta = content.pop("_draft_meta", {})
    contract_type = meta.get("contract_type", "dataset")
    
    # Increment version
    content["version"] = content.get("version", 0) + 1
    
    # Add to change history
    if "change_history" not in content:
        content["change_history"] = []
    
    content["change_history"].append({
        "version": content["version"],
        "date": datetime.utcnow().isoformat(),
        "author": "user",
        "message": request.commit_message
    })
    
    # Determine target path
    if contract_type == "dataset":
        target = content.get("dataset", {}).get("name", "unknown")
        layer = content.get("dataset", {}).get("layer", "unknown").lower()
        target_path = METADATA_PATH / "datasets" / layer / f"{target.split('.')[-1].lower()}.yaml"
    elif contract_type == "lineage":
        target = content.get("target", "unknown")
        layer = target.split(".")[0].replace("DW_", "").lower()
        target_path = METADATA_PATH / "lineage" / layer / f"{target.split('.')[-1].lower()}.lineage.yaml"
    elif contract_type == "recon":
        target = content.get("target", "unknown")
        layer = target.split(".")[0].replace("DW_", "").lower()
        target_path = METADATA_PATH / "recon" / layer / f"{target.split('.')[-1].lower()}.recon.yaml"
    else:
        raise HTTPException(status_code=400, detail="Invalid contract type")
    
    target_path.parent.mkdir(parents=True, exist_ok=True)
    
    # Check if creating new contract and file already exists
    # If original_path is None/Empty, it's a new creation
    if not meta.get("original_path") and target_path.exists():
        raise HTTPException(
            status_code=409, 
            detail=f"Contract already exists. Please use edit mode to update existing contracts."
        )
    
    with open(target_path, 'w') as f:
        dump_yaml(content, f)
    
    # Log to DuckDB
    try:
        duck = get_duckdb_connection(DUCKDB_PATH)
        duck.execute(
            """
            INSERT INTO contract_changes (id, contract_type, contract_path, action, changed_by, changed_at, version, commit_message)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [str(uuid.uuid4()), contract_type, str(target_path), meta.get("action", "modify"), "user", datetime.utcnow(), content["version"], request.commit_message]
        )
    except Exception:
        pass  # Non-critical
    
    # Delete draft
    draft_file.unlink()
    
    return {"status": "submitted", "path": str(target_path), "version": content["version"]}


# =============================================================================
# Validation Endpoints
# =============================================================================
@app.post("/validate/reverse-match")
def validate_reverse_match(request: ValidationRequest):
    """Run lineage validation queries."""
    # Load lineage contract
    dataset_parts = request.dataset.split(".")
    if len(dataset_parts) >= 2:
        layer = dataset_parts[0].replace("DW_", "").lower()
        name = dataset_parts[-1].lower()
    else:
        raise HTTPException(status_code=400, detail="Invalid dataset format")
    
    lineage_path = METADATA_PATH / "lineage" / layer / f"{name}.lineage.yaml"
    
    if not lineage_path.exists():
        raise HTTPException(status_code=404, detail="Lineage contract not found")
    
    with open(lineage_path, 'r') as f:
        lineage = yaml.safe_load(f)
    
    results = []
    for field_lineage in lineage.get("field_lineage", []):
        field = field_lineage.get("field")
        
        # Filter by requested fields
        if request.fields and field not in request.fields:
            continue
        
        if not field_lineage.get("validation_query"):
            results.append({
                "field": field,
                "type": field_lineage.get("type"),
                "status": "SKIPPED",
                "message": "No validation query defined"
            })
            continue

        try:
            # Execute validation query against SQLite
            # Assuming sqlite:// connection to standard data directory
            from src.recon import execute_sqlite_query
            query = field_lineage["validation_query"]
            params = request.parameters.copy() if request.parameters else {}
            
            # Apply default values for missing parameters
            for param_def in field_lineage.get("parameters", []):
                if param_def.get("name") not in params and "default" in param_def:
                    params[param_def["name"]] = param_def["default"]
            
            # Using same helper as recon.py
            # Note: For reverse match we often expect EMPTY result (no mismatches)
            # or equality check. The contract logic varies.
            # Usually Lineage validation query returns rows if MISMATCH found.
            
            error_count = 0
            # We treat the query as "Select failing rows" usually
            # But let's check field_lineage spec.
            # "Select ... WHERE ABS(diff) > X" -> returns failing rows
            
            # For this demo, let's assume we count failing rows or check returned values
            # execute_sqlite_query returns single scalar (first col first row) or None
            # If our query returns rows, fetchone will get the first one.
            
            # Let's adjust to use the helper which returns a scalar
            # If query is "SELECT ... WHERE ... > diff", existence of result means FAIL
            
            result_val = execute_sqlite_query(query, params, "./data")
            
            # Logic: If query returns ANY content (scalar or rows), it usually means mismatch/fail
            if result_val is not None:
                status = "FAIL"
                if isinstance(result_val, dict) and "rows" in result_val:
                    msg = f"Mismatch detected: {len(result_val['rows'])} sample rows found."
                    sample_data = result_val # Pass the whole dict {columns, rows}
                else:
                    msg = f"Mismatch detected. Value: {result_val}"
                    sample_data = None
            else:
                status = "PASS"
                msg = "Validation passed"
                sample_data = None

        except Exception as e:
            status = "ERROR"
            msg = str(e)

        results.append({
            "field": field,
            "type": field_lineage.get("type"),
            "status": status,
            "message": msg,
            "sample_data": sample_data if 'sample_data' in locals() else None,
            "validation_query": field_lineage.get("validation_query", "")[:200]
        })
    
    return {"dataset": request.dataset, "results": results}


@app.post("/validate/recon")
def validate_recon_contract(request: ValidationRequest):
    """Run dataset reconciliation (KPI) validation queries."""
    # Load recon contract
    dataset_parts = request.dataset.split(".")
    if len(dataset_parts) >= 2:
        layer = dataset_parts[0].replace("DW_", "").lower()
        name = dataset_parts[-1].lower()
    else:
        raise HTTPException(status_code=400, detail="Invalid dataset format")
    
    recon_path = METADATA_PATH / "recon" / layer / f"{name}.recon.yaml"
    
    if not recon_path.exists():
        raise HTTPException(status_code=404, detail="Reconciliation contract not found")
    
    with open(recon_path, 'r') as f:
        recon = yaml.safe_load(f)
    
    results = []
    from src.recon import execute_sqlite_query, check_value_match
    
    for validation in recon.get("validations", []):
        val_name = validation.get("name")
        
        # Filter by requested fields (reused as validation names here)
        if request.fields and val_name not in request.fields:
            continue
            
        try:
            # 1. Execute Source Query
            source_query = validation["source_query"]
            # Apply defaults
            params = request.parameters.copy() if request.parameters else {}
            for param_def in validation.get("parameters", []):
                if param_def.get("name") not in params and "default" in param_def:
                    params[param_def["name"]] = param_def["default"]

            source_val = execute_sqlite_query(source_query, params, "./data")
            
            # 2. Execute Target Query
            target_query = validation["target_query"]
            target_val = execute_sqlite_query(target_query, params, "./data")
            
            # 3. Compare
            # 3. Compare with robust handling for multi-row results
            sample_data = None
            if isinstance(source_val, dict) or isinstance(target_val, dict):
                 # One of the queries returned multiple rows (structured dict)
                 # This implies a complex check like "Find Duplicates" which returns bad rows
                 # If source_val is dict, it means we found something -> PROBABLY FAIL
                 # Unless the user intended to find rows. But typically validation queries return BAD rows.
                 
                 status = "FAIL"
                 msg = "Complex result detected (multi-row)."
                 if isinstance(source_val, dict):
                     msg = f"Source returned {len(source_val.get('rows', []))} rows."
                     sample_data = source_val
                 elif isinstance(target_val, dict):
                     msg = f"Target returned {len(target_val.get('rows', []))} rows."
                     # If target returns rows, maybe that's the reference?
                     # But let's assume if any query returns structured data, it's sample failure data.
                     sample_data = target_val
            else:
                match, diff = check_value_match(
                    source_val, 
                    target_val, 
                    validation.get("comparison", "EXACT_MATCH"), 
                    validation.get("tolerance")
                )
                
                status = "PASS" if match else "FAIL"
                msg = f"Match. Diff: {diff}" if match else f"Mismatch. Source: {source_val}, Target: {target_val}, Diff: {diff}"
            
        except Exception as e:
            status = "ERROR"
            msg = str(e)
            sample_data = None
            
        results.append({
            "field": val_name, # reuse field for validation name
            "type": "RECON_CHECK",
            "status": status,
            "message": msg,
            "sample_data": sample_data,
            "validation_query": f"Source: {source_query[:50]}... vs Target"
        })

    return {"dataset": request.dataset, "results": results}


# =============================================================================
# Metrics Endpoints
# =============================================================================
@app.get("/metrics/recon-history")
def get_recon_history(dataset: Optional[str] = None, limit: int = 100):
    """Get reconciliation run history."""
    try:
        duck = get_duckdb_connection(DUCKDB_PATH)
        
        if dataset:
            result = duck.execute(
                "SELECT * FROM recon_runs WHERE dataset = ? ORDER BY started_at DESC LIMIT ?",
                [dataset, limit]
            ).fetchall()
        else:
            result = duck.execute(
                "SELECT * FROM recon_runs ORDER BY started_at DESC LIMIT ?",
                [limit]
            ).fetchall()
        
        return {"history": result}
    except Exception as e:
        return {"history": [], "error": str(e)}


@app.get("/metrics/changes")
def get_contract_changes(limit: int = 100):
    """Get contract change log."""
    try:
        duck = get_duckdb_connection(DUCKDB_PATH)
        result = duck.execute(
            "SELECT * FROM contract_changes ORDER BY changed_at DESC LIMIT ?",
            [limit]
        ).fetchall()
        return {"changes": result}
    except Exception as e:
        return {"changes": [], "error": str(e)}


@app.get("/lineage/downstream/{id}")
def get_downstream_lineage(id: str, level: str = "dataset"):
    """Get downstream lineage (Blast Radius) for a dataset or field."""
    conn = get_kuzu_connection(KUZU_PATH)
    nodes = []
    edges = []
    debug_msg = ""
    
    # decode ID if needed (sometimes frontend sends URL encoded)
    from urllib.parse import unquote
    node_id = unquote(id)
    
    if level == "dataset":
        # Find datasets that depend on this one
        # (this) <-[DEPENDS_ON]- (downstream)
        # Note: Direction is inverted compared to upstream
        # Find datasets that depend on this one RECURSIVELY
        # (this) <-[DEPENDS_ON*]- (downstream)
        # Using variable length path
        result = conn.execute(
            """
            MATCH (d:Dataset {id: $id})<-[:DEPENDS_ON*]-(downstream:Dataset)
            RETURN DISTINCT downstream.id, downstream.name, downstream.layer, downstream.domain
            """,
            {"id": node_id}
        )
        
        downstream_ids = []
        # Add the start node to the set of IDs to check for edges, but don't add it to nodes list if it's the start
        all_related_ids = {node_id}
        
        while result.has_next():
            row = result.get_next()
            ds_id = row[0]
            ds_name = row[1]
            ds_layer = row[2]
            ds_domain = row[3]
            
            if ds_id == node_id:
                continue
                
            downstream_ids.append(ds_id)
            all_related_ids.add(ds_id)
            
            # Fetch metadata for downstream dataset
            meta = {}
            pk = None
            try:
                parts = ds_id.split(".")
                if len(parts) >= 2:
                    l = parts[0].replace("DW_", "").lower()
                    n = parts[-1].lower()
                    p = METADATA_PATH / "datasets" / l / f"{n}.yaml"
                    if p.exists():
                        with open(p, 'r', encoding='utf-8') as f:
                            c = yaml.safe_load(f)
                            meta = c.get("dataset", {})
                            pk = c.get("primary_key")
            except Exception:
                pass

            nodes.append({
                "id": ds_id,
                "type": "source_dataset", # Reusing source_dataset style
                "data": {
                    "label": ds_name,
                    "fullName": ds_id,
                    "layer": ds_layer,
                    "domain": ds_domain,
                    "description": meta.get("description"),
                    "owner": meta.get("owner"),
                    "primary_keys": pk,
                    "originalType": "downstream_dataset"
                },
                "position": {"x": 0, "y": 0}
            })
            
        # 3. Add Edges - Query edges between all relevant nodes
        if len(all_related_ids) > 1:
            ids_list = list(all_related_ids)
            # Create WHERE clause for ID inclusion
            # formatting strings for query safety in Kuzu
            ids_str = ", ".join([f"'{x}'" for x in ids_list])
            
            edge_query = f"""
                MATCH (a:Dataset)-[r:DEPENDS_ON]->(b:Dataset)
                WHERE a.id IN [{ids_str}] AND b.id IN [{ids_str}]
                RETURN a.id, b.id
            """
            
            try:
                edge_res = conn.execute(edge_query)
                seen_edges = set()
                while edge_res.has_next():
                    erow = edge_res.get_next()
                    src = erow[0]
                    dst = erow[1]
                    
                    # We only care about edges in our sub-graph
                    if src not in all_related_ids or dst not in all_related_ids:
                        continue
                        
                    edge_key = f"{src}->{dst}"
                    if edge_key not in seen_edges:
                        edges.append({
                            "id": f"e-{dst}-{src}", # Inverted ID
                            "source": dst, # Swapped: Provider (dst) -> Consumer (src)
                            "target": src, # Swapped: Consumer (src)
                            "type": "depends_on",
                            "label": "DEPENDS ON", # Added label
                            "animated": True
                        })
                        seen_edges.add(edge_key)
            except Exception as e:
                print(f"Error fetching edges: {e}")
            
    else:
        # Field level downstream
        try:
             # Find downstream fields recursively AND their parent datasets
             # Using * for variable length path to find all downstream
             query = """
                MATCH (f:Field {id: $id})<-[r*]-(downstream:Field)<-[:CONTAINS]-(d:Dataset)
                RETURN downstream.id, downstream.name, downstream.data_type, d.id, d.name, d.layer, d.domain
             """
             result = conn.execute(query, {"id": node_id})
             
             # Track unique nodes to prevent duplicates
             added_node_ids = set()
             
             while result.has_next():
                row = result.get_next()
                f_id = row[0]
                f_name = row[1]
                f_dtype = row[2]
                ds_id = row[3]
                ds_name = row[4]
                ds_layer = row[5]
                ds_domain = row[6]
                
                # 1. Add Dataset Node (target_dataset) if not present
                if ds_id not in added_node_ids:
                    nodes.append({
                        "id": ds_id,
                        "type": "target_dataset",
                        "data": {
                            "label": ds_name,
                            "layer": ds_layer,
                            "domain": ds_domain,
                            "fullName": ds_id,
                            "originalType": "target_dataset"
                        },
                        "position": {"x": 0, "y": 0}
                    })
                    added_node_ids.add(ds_id)

                # 2. Add Field Node (target_field)
                if f_id not in added_node_ids:
                    nodes.append({
                        "id": f_id,
                        "type": "target_field",
                        "data": {
                            "label": f_name,
                            "column": 0,
                            "dataset": ds_id,
                            "data_type": f_dtype,
                            "originalType": "target_field"
                        },
                        "position": {"x": 0, "y": 0}
                    })
                    added_node_ids.add(f_id)
                
             # 3. Add Edges - Requery for edges between all found nodes
             if len(added_node_ids) > 1:
                ids_list = list(added_node_ids)
                all_relevant_ids = ids_list + [node_id]
                rel_ids_str = ", ".join([f"'{x}'" for x in all_relevant_ids])
                
                edge_query = f"""
                    MATCH (a:Field)-[r]->(b:Field)
                    WHERE a.id IN [{rel_ids_str}] AND b.id IN [{rel_ids_str}]
                    RETURN a.id, b.id, label(r)
                """
                edge_res = conn.execute(edge_query)
                seen_edges = set()
                while edge_res.has_next():
                    erow = edge_res.get_next()
                    src = erow[0]
                    dst = erow[1]
                    lbl = erow[2]
                    edge_key = f"{src}->{dst}"
                    if edge_key not in seen_edges:
                        edges.append({
                            "id": f"e-{dst}-{src}", # ID also updated to reflect direction
                            "source": dst, # Upstream (provider)
                            "target": src, # Downstream (consumer)
                            "type": lbl.lower(),
                            "label": lbl.replace("_", " "),
                            "animated": True
                        })
                        seen_edges.add(edge_key)
            
             debug_msg = f"Found {len(nodes)} downstream nodes (recursive)."

             
             # DEBUG: Check if we found anything
             debug_msg = f"Checked {node_id} (Level: {level}). Found {len(nodes)} nodes."
             if len(nodes) == 0:
                 # Try to see if node exists
                 check = conn.execute("MATCH (n {id: $id}) RETURN n.id, labels(n)", {"id": node_id})
                 if check.has_next():
                     debug_msg += f" Node exists: {check.get_next()}."
                     # Check any incoming relationships
                     rels = conn.execute("MATCH (n {id: $id})<-[r]-(m) RETURN label(r), m.id LIMIT 5", {"id": node_id})
                     rels_found = []
                     while rels.has_next():
                         rels_found.append(str(rels.get_next()))
                     debug_msg += f" Incoming Rels: {rels_found}"
                 else:
                     debug_msg += " Node does NOT exist."



        except Exception as e:
            print(f"Error fetching field downstream: {e}")
            return {"nodes": [], "edges": [], "error": str(e)}

    return {"nodes": nodes, "edges": edges, "debug": debug_msg}


# =============================================================================
# Health Check
# =============================================================================
@app.get("/health")
def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
