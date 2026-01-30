"""
Referential integrity validation for lineage contracts.
Ensures all referenced datasets/fields exist in dataset contracts.
"""
from pathlib import Path
from typing import Any
import yaml

from src.models import DatasetContract, LineageContract


class IntegrityError:
    """Represents an integrity error."""
    def __init__(self, file: str, message: str):
        self.file = file
        self.message = message
    
    def __str__(self):
        return f"❌ {self.file}: {self.message}"


def load_all_datasets(metadata_path: Path) -> dict[str, set[str]]:
    """Load all datasets and their fields from dataset contracts."""
    datasets = {}
    
    for yaml_file in metadata_path.glob("datasets/**/*.yaml"):
        with open(yaml_file, 'r', encoding='utf-8') as f:
            data = yaml.safe_load(f)
        
        try:
            contract = DatasetContract(**data)
            dataset_name = contract.dataset.name
            field_names = {f.name for f in contract.fields}
            datasets[dataset_name] = field_names
        except Exception:
            pass  # Schema validation will catch this
    
    return datasets


def validate_lineage_integrity(metadata_path: str = "./metadata") -> list[IntegrityError]:
    """
    Validate that all fields referenced in lineage contracts exist in dataset contracts.
    """
    metadata = Path(metadata_path)
    errors = []
    
    # Load all known datasets and fields
    known_datasets = load_all_datasets(metadata)
    
    # Check each lineage contract
    for yaml_file in metadata.glob("lineage/**/*.lineage.yaml"):
        with open(yaml_file, 'r', encoding='utf-8') as f:
            data = yaml.safe_load(f)
        
        try:
            contract = LineageContract(**data)
            target_dataset = contract.target
            
            # Check target dataset exists
            if target_dataset not in known_datasets:
                errors.append(IntegrityError(
                    str(yaml_file),
                    f"Target dataset '{target_dataset}' not found in dataset contracts"
                ))
            else:
                # Check each field in lineage exists in target dataset
                for lineage in contract.field_lineage:
                    if lineage.field not in known_datasets.get(target_dataset, set()):
                        errors.append(IntegrityError(
                            str(yaml_file),
                            f"Field '{lineage.field}' not found in dataset '{target_dataset}'"
                        ))
        except Exception:
            pass  # Schema validation will catch this
    
    return errors
