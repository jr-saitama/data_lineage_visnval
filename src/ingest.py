"""
Ingestion engine - loads YAML contracts into KuzuDB graph.
"""
import yaml
from pathlib import Path
from typing import Any

from src.models import DatasetContract, LineageContract
from src.database import init_kuzu_schema, get_kuzu_connection


def load_yaml_file(file_path: Path) -> dict[str, Any]:
    """Load and parse a YAML file."""
    with open(file_path, 'r', encoding='utf-8') as f:
        return yaml.safe_load(f)


def node_exists(conn, table: str, id_val: str) -> bool:
    """Check if a node exists."""
    # Table name cannot be parameterized, validation is ensuring it's safe or internal
    result = conn.execute(
        f"MATCH (n:{table}) WHERE n.id = $id RETURN n.id",
        {"id": id_val}
    )
    return result.has_next()


def ingest_dataset(conn, data: dict[str, Any]) -> None:
    """Ingest a dataset contract into the graph."""
    contract = DatasetContract(**data)
    dataset = contract.dataset
    dataset_id = dataset.name
    
    print(f"Processing dataset: {dataset_id}")
    params = {
        "id": dataset_id,
        "name": dataset.name,
        "layer": dataset.layer,
        "domain": dataset.domain,
        "description": dataset.description or ""
    }
    
    # Insert or Update Dataset node
    if not node_exists(conn, "Dataset", dataset_id):
        conn.execute(
            "CREATE (d:Dataset { id: $id, name: $name, layer: $layer, domain: $domain, description: $description })",
            params
        )
    else:
        # Update existing properties
        conn.execute(
            "MATCH (d:Dataset) WHERE d.id = $id SET d.name = $name, d.layer = $layer, d.domain = $domain, d.description = $description",
            params
        )
    
    # Insert Field nodes and CONTAINS relationships
    for field in contract.fields:
        field_id = f"{dataset_id}.{field.name}"
        
        if not node_exists(conn, "Field", field_id):
            conn.execute("""
                CREATE (f:Field {
                    id: $id,
                    name: $name,
                    data_type: $data_type,
                    nullable: $nullable,
                    adjustable: $adjustable
                })
            """, {
                "id": field_id,
                "name": field.name,
                "data_type": field.data_type,
                "nullable": field.nullable,
                "adjustable": field.adjustable
            })
        
        # Create CONTAINS relationship (idempotent logic usually needed, but minimal check here)
        # Using MERGE would be better if supported, but Kuzu might not support MERGE fully or we stick to CREATE after check
        # Checking relationship existence is expensive, we assume hierarchy is static-ish or okay to duplicates? 
        # Actually Kuzu doesn't support generic MERGE on rels effectively in all versions. 
        # But let's check if rel exists or just delete old?
        # For simplicity and perf, we delete old CONTAINS for this field? No.
        # Let's just create. Kuzu allows multi-edges. duplicates are possible. 
        # Ideally we check:
        # MATCH (d)-[r:CONTAINS]->(f) ...
        # But previous code didn't check either. It just ran CREATE. We'll stick to that but maybe check existing?
        # Let's check if connected to avoid duplication.
        
        rel_exists = conn.execute(
            "MATCH (d:Dataset {id: $did})-[:CONTAINS]->(f:Field {id: $fid}) RETURN d.id",
            {"did": dataset_id, "fid": field_id}
        ).has_next()
        
        if not rel_exists:
            conn.execute(
                "MATCH (d:Dataset), (f:Field) WHERE d.id = $did AND f.id = $fid CREATE (d)-[:CONTAINS]->(f)",
                {"did": dataset_id, "fid": field_id}
            )


def ensure_dataset(conn, dataset_id: str) -> None:
    """Ensure a dataset node exists."""
    if not node_exists(conn, "Dataset", dataset_id):
        conn.execute("""
            CREATE (d:Dataset {
                id: $id,
                name: $id,
                layer: '',
                domain: '',
                description: ''
            })
        """, {"id": dataset_id})


def ensure_field(conn, field_id: str) -> None:
    """Ensure a field node exists."""
    if not node_exists(conn, "Field", field_id):
        name = field_id.split(".")[-1] if "." in field_id else field_id
        conn.execute("""
            CREATE (f:Field {
                id: $id,
                name: $name,
                data_type: '',
                nullable: true,
                adjustable: false
            })
        """, {"id": field_id, "name": name})


def ingest_lineage(conn, data: dict[str, Any]) -> None:
    """Ingest a lineage contract into the graph."""
    contract = LineageContract(**data)
    target_dataset = contract.target
    
    # Ensure target dataset exists
    ensure_dataset(conn, target_dataset)
    
    # Process dataset dependencies
    for dep in contract.dataset_dependencies:
        ensure_dataset(conn, dep)
        
        # Check rel
        rel_exists = conn.execute(
            "MATCH (t:Dataset {id: $tid})-[:DEPENDS_ON]->(s:Dataset {id: $sid}) RETURN t.id",
            {"tid": target_dataset, "sid": dep}
        ).has_next()
        
        if not rel_exists:
            conn.execute(
                "MATCH (t:Dataset), (s:Dataset) WHERE t.id = $tid AND s.id = $sid CREATE (t)-[:DEPENDS_ON]->(s)",
                {"tid": target_dataset, "sid": dep}
            )
    
    # Process field lineage
    for lineage in contract.field_lineage:
        target_field_id = f"{target_dataset}.{lineage.field}"
        
        # Ensure target field exists
        ensure_field(conn, target_field_id)
        
        validation_query = lineage.validation_query or ""
        
        for source in lineage.sources:
            source_field_id = f"{source.dataset}.{source.field}"
            
            # Ensure source dataset and field exist
            ensure_dataset(conn, source.dataset)
            ensure_field(conn, source_field_id)
            
            # Create relationship based on type
            rel_type = lineage.type
            
            # Check for existing relationship of same type to avoid duplicates
            # (Simplification: we allow only one edge of specific type between these two nodes? 
            #  Or just blindly create as before? Previous code blindly created.)
            # Better to check.
            
            # Note: Cannot parameterize rel type in MATCH either.
            rel_check_query = f"MATCH (t:Field {{id: $tid}})-[r:{rel_type}]->(s:Field {{id: $sid}}) RETURN r"
            rel_exists = conn.execute(rel_check_query, {"tid": target_field_id, "sid": source_field_id}).has_next()

            # If we want to update the validation query on existing edge?
            # Kuzu doesn't easily support updating rel properties via MATCH in all cases effortlessly without knowing ID?
            # Actually MATCH ()-[r]->() SET r.prop = val Works.
            
            if rel_exists:
                 conn.execute(
                    f"MATCH (t:Field {{id: $tid}})-[r:{rel_type}]->(s:Field {{id: $sid}}) SET r.validation_query = $vq",
                    {"tid": target_field_id, "sid": source_field_id, "vq": validation_query}
                 )
            else:
                conn.execute(
                    f"MATCH (t:Field), (s:Field) WHERE t.id = $tid AND s.id = $sid CREATE (t)-[:{rel_type} {{validation_query: $vq}}]->(s)",
                    {"tid": target_field_id, "sid": source_field_id, "vq": validation_query}
                )


def ingest_all_contracts(metadata_path: str = "./metadata", db_path: str = "./kuzu_db") -> dict:
    """Ingest all contracts from metadata directory."""
    conn = get_kuzu_connection(db_path)
    metadata = Path(metadata_path)
    
    stats = {"datasets": 0, "lineage": 0, "recon": 0}
    
    # Ingest datasets
    for yaml_file in metadata.glob("datasets/**/*.yaml"):
        data = load_yaml_file(yaml_file)
        ingest_dataset(conn, data)
        stats["datasets"] += 1
        print(f"✓ Ingested dataset: {yaml_file.name}")
    
    # Ingest lineage
    for yaml_file in metadata.glob("lineage/**/*.lineage.yaml"):
        data = load_yaml_file(yaml_file)
        ingest_lineage(conn, data)
        stats["lineage"] += 1
        print(f"✓ Ingested lineage: {yaml_file.name}")
    
    # Recon contracts are stored for runtime, not ingested into graph
    for yaml_file in metadata.glob("recon/**/*.recon.yaml"):
        stats["recon"] += 1
        print(f"✓ Found recon: {yaml_file.name}")
    
    return stats


def main():
    """Main entry point for ingestion."""
    import argparse
    import shutil
    
    parser = argparse.ArgumentParser(description="Ingest metadata contracts into KuzuDB")
    parser.add_argument("--init", action="store_true", help="Initialize fresh database")
    parser.add_argument("--metadata", default="./metadata", help="Path to metadata directory")
    parser.add_argument("--db", default="./kuzu_db", help="Path to KuzuDB directory")
    
    args = parser.parse_args()
    
    if args.init:
        print("Initializing fresh database...")
        db_path = Path(args.db)
        # Close connection if held elsewhere? Kuzu handles it if process bounds.
        # But we need to be careful if api.py is running.
        # The user is running uvicorn. This script might conflict on lock if run in parallel.
        # However, kuzu usually locks the directory.
        # We might need to stop uvicorn or just try.
        if db_path.exists():
            try:
                shutil.rmtree(db_path)
            except Exception as e:
                print(f"Warning: Could not delete {db_path}: {e}")
        
        init_kuzu_schema(args.db)
        print("✓ Database initialized")
    
    print(f"\nIngesting contracts from {args.metadata}...")
    try:
        stats = ingest_all_contracts(args.metadata, args.db)
        print(f"\n=== Ingestion Complete ===")
        print(f"Datasets: {stats['datasets']}")
        print(f"Lineage:  {stats['lineage']}")
        print(f"Recon:    {stats['recon']}")
    except Exception as e:
        print(f"Error during ingestion: {e}")
        # Traceback
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()
