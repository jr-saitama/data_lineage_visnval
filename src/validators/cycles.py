"""
Circular lineage detection - finds cycles in the lineage graph.
"""
from pathlib import Path
from collections import defaultdict
import yaml

from src.models import LineageContract


class CycleError:
    """Represents a cycle detection error."""
    def __init__(self, cycle: list[str]):
        self.cycle = cycle
    
    def __str__(self):
        cycle_str = " -> ".join(self.cycle)
        return f"❌ Circular dependency detected: {cycle_str}"


def build_dependency_graph(metadata_path: str = "./metadata") -> dict[str, set[str]]:
    """Build a graph of field dependencies from lineage contracts."""
    metadata = Path(metadata_path)
    graph = defaultdict(set)
    
    for yaml_file in metadata.glob("lineage/**/*.lineage.yaml"):
        with open(yaml_file, 'r', encoding='utf-8') as f:
            data = yaml.safe_load(f)
        
        try:
            contract = LineageContract(**data)
            target_dataset = contract.target
            
            for lineage in contract.field_lineage:
                target_field = f"{target_dataset}.{lineage.field}"
                
                for source in lineage.sources:
                    source_field = f"{source.dataset}.{source.field}"
                    graph[target_field].add(source_field)
        except Exception:
            pass
    
    return dict(graph)


def find_cycles(graph: dict[str, set[str]]) -> list[list[str]]:
    """Find all cycles in the dependency graph using DFS."""
    cycles = []
    visited = set()
    rec_stack = set()
    path = []
    
    def dfs(node: str) -> bool:
        visited.add(node)
        rec_stack.add(node)
        path.append(node)
        
        for neighbor in graph.get(node, set()):
            if neighbor not in visited:
                if dfs(neighbor):
                    return True
            elif neighbor in rec_stack:
                # Found a cycle
                cycle_start = path.index(neighbor)
                cycles.append(path[cycle_start:] + [neighbor])
                return True
        
        path.pop()
        rec_stack.remove(node)
        return False
    
    for node in graph:
        if node not in visited:
            dfs(node)
    
    return cycles


def detect_circular_lineage(metadata_path: str = "./metadata") -> list[CycleError]:
    """Detect circular dependencies in lineage contracts."""
    graph = build_dependency_graph(metadata_path)
    cycles = find_cycles(graph)
    return [CycleError(cycle) for cycle in cycles]
