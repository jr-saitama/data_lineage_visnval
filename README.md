# Data Lineage & Reconciliation System

A metadata-driven data lineage and quality assurance system built with **KuzuDB** (embedded graph database) and **DuckDB** (analytical engine).

## Features

### Data Lineage Visualization

- **Interactive Graph**: Visualize complex dependencies between datasets and fields.
- **Drill-Down**: Explore lineage depth-first with context menus.
- **Search**: Quickly locate datasets and fields within the graph.
- **Dataset Grouping**: Logical grouping of fields within dataset boundaries.

### Contract Management

- **Schema & Lineage Contracts**: Define expected schemas and upstream dependencies in YAML.
- **Validation**: Ensure contracts meet strict schema requirements before saving.
- **Version Control**: Track changes with commit messages.

### Reconciliation

- **Automated Checks**: Run SQL-based validation rules (e.g., row counts, null checks).
- **Visual Feedback**: Instantly see pass/fail status on the graph.
- **Sample Data**: Inspect failing rows directly in the UI.

## Documentation

- **[User Guide (USAGE.md)](./docs/USAGE.md)**: Detailed instructions on how to use the application features.

## Quick Start

```bash
# 1. Initialize databases
uv run python -m src.cli init

# 2. Start API server
uv run uvicorn src.api:app --reload

# 3. Start Frontend (in a new terminal)
cd frontend && npm run dev
```

## Project Structure

```txt
├── metadata/
│   ├── datasets/    # Dataset definition contracts (YAML)
│   ├── lineage/     # Lineage dependency contracts (YAML)
│   └── recon/       # Reconciliation logic (YAML)
├── src/
│   ├── api.py       # FastAPI backend
│   ├── cli.py       # Command-line interface
│   ├── ingest.py    # Graph ingestion logic
│   └── validators/  # Contract validation rules
└── frontend/        # React + React Flow application
```
