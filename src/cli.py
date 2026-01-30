"""
CLI for metadata validation and management.

Commands:
  metadata validate         - YAML schema validation
  metadata lineage check    - Referential integrity + cycle detection
  metadata diff             - Contract diff against baseline
"""
import argparse
import sys
from pathlib import Path

from src.validators.schema import validate_all_schemas
from src.validators.integrity import validate_lineage_integrity
from src.validators.cycles import detect_circular_lineage
from src.ingest import ingest_all_contracts
from src.database import init_kuzu_schema, init_duckdb_schema


def cmd_validate(args):
    """Run schema validation on all contracts."""
    print("Running schema validation...")
    errors = validate_all_schemas(args.metadata)
    
    if errors:
        print(f"\n{len(errors)} validation error(s) found:\n")
        for error in errors:
            print(f"  {error}")
        return 1
    else:
        print("✓ All contracts are valid")
        return 0


def cmd_lineage_check(args):
    """Run lineage integrity and cycle checks."""
    print("Checking lineage integrity...")
    integrity_errors = validate_lineage_integrity(args.metadata)
    
    print("Checking for circular dependencies...")
    cycle_errors = detect_circular_lineage(args.metadata)
    
    all_errors = integrity_errors + cycle_errors
    
    if all_errors:
        print(f"\n{len(all_errors)} error(s) found:\n")
        for error in all_errors:
            print(f"  {error}")
        return 1
    else:
        print("✓ Lineage checks passed")
        return 0


def cmd_diff(args):
    """Show diff against baseline (placeholder)."""
    print(f"Comparing against baseline: {args.baseline}")
    print("⚠️  Diff functionality requires git integration (not yet implemented)")
    return 0


def cmd_init(args):
    """Initialize databases."""
    print("Initializing KuzuDB...")
    init_kuzu_schema(args.db)
    print("✓ KuzuDB initialized")
    
    print("Initializing DuckDB...")
    init_duckdb_schema(args.metrics_db)
    print("✓ DuckDB initialized")
    
    return 0


def cmd_ingest(args):
    """Ingest all contracts."""
    if args.init:
        cmd_init(args)
    
    stats = ingest_all_contracts(args.metadata, args.db)
    print(f"\n✓ Ingestion complete: {stats}")
    return 0


def main():
    parser = argparse.ArgumentParser(
        prog="metadata",
        description="Data Lineage Metadata CLI"
    )
    parser.add_argument("--metadata", default="./metadata", help="Metadata directory")
    parser.add_argument("--db", default="./kuzu_db", help="KuzuDB path")
    parser.add_argument("--metrics-db", default="./metrics.duckdb", help="DuckDB path")
    
    subparsers = parser.add_subparsers(dest="command", help="Commands")
    
    # validate
    validate_parser = subparsers.add_parser("validate", help="Schema validation")
    validate_parser.set_defaults(func=cmd_validate)
    
    # lineage
    lineage_parser = subparsers.add_parser("lineage", help="Lineage commands")
    lineage_sub = lineage_parser.add_subparsers(dest="lineage_cmd")
    check_parser = lineage_sub.add_parser("check", help="Check integrity & cycles")
    check_parser.set_defaults(func=cmd_lineage_check)
    
    # diff
    diff_parser = subparsers.add_parser("diff", help="Diff against baseline")
    diff_parser.add_argument("--baseline", default="main", help="Baseline branch")
    diff_parser.set_defaults(func=cmd_diff)
    
    # init
    init_parser = subparsers.add_parser("init", help="Initialize databases")
    init_parser.set_defaults(func=cmd_init)
    
    # ingest
    ingest_parser = subparsers.add_parser("ingest", help="Ingest contracts")
    ingest_parser.add_argument("--init", action="store_true", help="Initialize first")
    ingest_parser.set_defaults(func=cmd_ingest)
    
    args = parser.parse_args()
    
    if args.command is None:
        parser.print_help()
        return 0
    
    if hasattr(args, 'func'):
        return args.func(args)
    
    if args.command == "lineage" and args.lineage_cmd is None:
        lineage_parser.print_help()
        return 0
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
