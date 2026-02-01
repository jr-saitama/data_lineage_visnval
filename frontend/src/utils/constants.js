
export const CONTRACT_TEMPLATES = {
    lineage: `# Example Lineage Contract
target: DW_GOLD.YOUR_DATASET
dataset_dependencies:
  - DW_SILVER.SOURCE_TABLE
field_lineage:
  - field: YOUR_FIELD
    type: copied_from
    sources:
      - dataset: DW_SILVER.SOURCE_TABLE
        field: SOURCE_FIELD
`,
    dataset: `# Example Dataset Contract
dataset:
  name: DW_SILVER.YOUR_DATASET
  layer: silver
  domain: sales
  description: "Description of your dataset"
schema:
  - name: ID
    type: string
    description: "Unique identifier"
    nullable: false
  - name: NAME
    type: string
    description: "Entity name"
`,
    recon: `# Example Reconciliation Contract
target: DW_GOLD.YOUR_DATASET
validations:
  - name: total_row_count
    type: query
    query: |
      SELECT COUNT(*) FROM DW_GOLD.YOUR_DATASET
    expected:
      type: range
      min: 1
  - name: null_check_id
    type: not_null
      field: ID
`
}
