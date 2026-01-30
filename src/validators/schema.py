"""
Schema validation for YAML contracts using Pydantic.
"""
from pathlib import Path
from typing import Any
import yaml

from src.models import DatasetContract, LineageContract, ReconContract


class ValidationError:
    """Represents a validation error."""
    def __init__(self, file: str, message: str, severity: str = "error"):
        self.file = file
        self.message = message
        self.severity = severity
    
    def __str__(self):
        icon = "❌" if self.severity == "error" else "⚠️"
        return f"{icon} {self.file}: {self.message}"


def validate_dataset_schema(file_path: Path) -> list[ValidationError]:
    """Validate a dataset contract against schema."""
    errors = []
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = yaml.safe_load(f)
        DatasetContract(**data)
    except Exception as e:
        errors.append(ValidationError(str(file_path), str(e)))
    return errors


def validate_lineage_schema(file_path: Path) -> list[ValidationError]:
    """Validate a lineage contract against schema."""
    errors = []
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = yaml.safe_load(f)
        LineageContract(**data)
    except Exception as e:
        errors.append(ValidationError(str(file_path), str(e)))
    return errors


def validate_recon_schema(file_path: Path) -> list[ValidationError]:
    """Validate a recon contract against schema."""
    errors = []
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = yaml.safe_load(f)
        ReconContract(**data)
    except Exception as e:
        errors.append(ValidationError(str(file_path), str(e)))
    return errors


def validate_all_schemas(metadata_path: str = "./metadata") -> list[ValidationError]:
    """Validate all contracts in metadata directory."""
    metadata = Path(metadata_path)
    errors = []
    
    # Validate datasets
    for yaml_file in metadata.glob("datasets/**/*.yaml"):
        errors.extend(validate_dataset_schema(yaml_file))
    
    # Validate lineage
    for yaml_file in metadata.glob("lineage/**/*.lineage.yaml"):
        errors.extend(validate_lineage_schema(yaml_file))
    
    # Validate recon
    for yaml_file in metadata.glob("recon/**/*.recon.yaml"):
        errors.extend(validate_recon_schema(yaml_file))
    
    return errors
