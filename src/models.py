"""
Pydantic models for Data Lineage & Reconciliation System contracts.
"""
from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field


# =============================================================================
# Change History
# =============================================================================
class ChangeHistoryEntry(BaseModel):
    """Single entry in contract change history."""
    version: int
    date: datetime
    author: str
    message: str


# =============================================================================
# Dataset Contract Models
# =============================================================================
class OwnerInfo(BaseModel):
    """Dataset owner information."""
    team: str
    email: str


class ClassificationInfo(BaseModel):
    """Data classification details."""
    pii: bool = False
    confidential: bool = False


class FieldDefinition(BaseModel):
    """Field/column metadata in a dataset."""
    name: str
    data_type: str
    nullable: bool = True
    adjustable: bool = False
    description: Optional[str] = None
    sample_values: Optional[list[str]] = None
    valid_values: Optional[list[str]] = None


class DatasetInfo(BaseModel):
    """Core dataset metadata."""
    name: str
    layer: str
    domain: str
    type: Literal["TABLE", "VIEW", "MATERIALIZED_VIEW"] = "TABLE"
    owner: OwnerInfo
    classification: ClassificationInfo
    description: Optional[str] = None


class DatasetContract(BaseModel):
    """Complete dataset contract schema."""
    meta_version: str = "2.0"
    version: int = 1
    change_history: list[ChangeHistoryEntry] = Field(default_factory=list)
    dataset: DatasetInfo
    primary_key: list[str]
    fields: list[FieldDefinition]


# =============================================================================
# Lineage Contract Models
# =============================================================================
class ParameterDefinition(BaseModel):
    """Query parameter with prompt for UI."""
    name: str
    type: Literal["STRING", "NUMBER", "DATE"]
    prompt: str
    default: Optional[str | int | float] = None


class LineageSource(BaseModel):
    """Source field reference."""
    dataset: str
    field: str


class FieldLineage(BaseModel):
    """Lineage definition for a single field."""
    field: str
    type: Literal["COPIED_FROM", "LOOKED_UP_FROM", "CALCULATED_FROM", "DERIVED_FROM"]
    sources: list[LineageSource]
    parameters: Optional[list[ParameterDefinition]] = None
    validation_query: Optional[str] = None


class LineageContract(BaseModel):
    """Complete lineage contract schema."""
    meta_version: str = "2.0"
    version: int = 1
    change_history: list[ChangeHistoryEntry] = Field(default_factory=list)
    target: str
    field_lineage: list[FieldLineage]
    dataset_dependencies: list[str] = Field(default_factory=list)


# =============================================================================
# Reconciliation Contract Models
# =============================================================================
class ReconValidation(BaseModel):
    """Single reconciliation validation rule."""
    name: str
    description: Optional[str] = None
    source_query: str
    target_query: str
    parameters: Optional[list[ParameterDefinition]] = None
    tolerance: Optional[float] = None
    comparison: Literal["EXACT_MATCH", "NUMERIC_MATCH", "DISTRIBUTION_MATCH"] = "EXACT_MATCH"


class ReconContract(BaseModel):
    """Complete reconciliation contract schema."""
    meta_version: str = "2.0"
    version: int = 1
    change_history: list[ChangeHistoryEntry] = Field(default_factory=list)
    target: str
    validations: list[ReconValidation]


# =============================================================================
# Draft Contract Models
# =============================================================================
class DraftMetadata(BaseModel):
    """Metadata for a draft contract."""
    draft_id: str
    original_path: Optional[str] = None
    contract_type: Literal["dataset", "lineage", "recon"]
    action: Literal["create", "modify", "delete"]
    created_at: datetime
    user: str


class DraftContract(BaseModel):
    """Wrapper for draft contracts."""
    _draft_meta: DraftMetadata
    content: DatasetContract | LineageContract | ReconContract
