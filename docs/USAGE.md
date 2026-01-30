# User Guide

This guide explains how to use the **Data Lineage Explorer** to visualize data dependencies, manage contracts, and perform reconciliation checks.

## 1. Lineage Visualization

The main interface displays a directed graph of datasets and fields.

- **Datasets (Nodes)**:
  - **Blue Nodes**: Source datasets/fields (e.g., `DW_SILVER.ORDERS`).
  - **Purple Nodes**: Target datasets/fields (e.g., `DW_GOLD.ORDERS_FACT`).
  - **Green Borders**: Validated fields.
  - **Red/Yellow Borders**: Fields with issues or warnings.

- **Lineage Edges**:
  - **Green (Solid)**: Direct copy (`COPIED_FROM`).
  - **Purple (Dashed)**: Lookup dependencies (`LOOKED_UP_FROM`).
  - **Blue (Dotted)**: Calculation logic (`CALCULATED_FROM`).
  - **Red (Bold)**: Derived transformations (`DERIVED_FROM`).

### Interaction

- **Pan & Zoom**: Use your mouse wheel or drag the canvas to navigate.
- **Search**: Use the search bar in the top-right corner to foster datasets or specific fields. Clicking a result centers the view on that node.

### Context Menu & Drill-Down

Click on any **Source Field** node to open the context menu.

- **Expand / Drill Down**: Loads the next level of upstream dependencies for that field.
- **Collapse**: Hides the upstream dependencies to clean up the view.
- **View Details**: (Future) Shows metadata and schema information.

---

## 2. Contract Management

Click the **Contracts** button in the top-right corner to open the management panel.

- **View Contracts**: Browse existing contracts for datasets and lineage.
- **Search**: Filter contracts by name, layer, or type.
- **Create New**: Click `+ New Contract` to open the editor.
- **Edit**: Click the `Edit` button on any contract card.

### Contract Editor

The editor supports YAML with validation:

- **Format**: Checks for valid YAML syntax.
- **Schema Validation**: Ensures required fields (e.g., `target`, `field_lineage`) are present.
- **Live Preview**: See validation errors in real-time.
- **Commit Message**: Required when saving changes for audit trails.

---

## 3. Reconciliation (Data Quality)

Click the **Reconciliation** button to open the recon panel.

- **Run Checks**: Execute defined SQL checks (e.g., row counts, null checks) against the database.
- **View Results**:
  - **Pass**: Green checkmark.
  - **Fail**: Red cross with error details.
  - **Sample Data**: View failing rows for debugging.

---

## 4. Setup & Running

### Prerequisites

- Python 3.12+
- Node.js 18+
- `uv` (Python package manager)

### Installation

```bash
# Install Python dependencies
uv sync

# Install Frontend dependencies
cd frontend
npm install
```

### Running the Application

1. **Backend API**:

    ```bash
    uv run uvicorn src.api:app --reload
    ```

    Runs on `http://127.0.0.1:8000`.

2. **Frontend**:

    ```bash
    cd frontend
    npm run dev
    ```

    Runs on `http://localhost:5173`.
