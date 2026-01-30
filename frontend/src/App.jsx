import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Panel,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react'
import CodeMirror from '@uiw/react-codemirror'
import { loadLanguage } from '@uiw/codemirror-extensions-langs'
import { vscodeDark } from '@uiw/codemirror-theme-vscode'
import { Toaster, toast } from 'sonner'
import yaml from 'js-yaml'
// Using custom layout algorithm instead of dagre
import '@xyflow/react/dist/style.css'
import './App.css'

const API_BASE = 'http://127.0.0.1:8000'

// Calculate node width based on label length - no max limit for full text
const calculateNodeWidth = (label) => {
  const baseWidth = 120
  const charWidth = 9 // slightly wider for better readability
  const padding = 50
  return Math.max(baseWidth, label.length * charWidth + padding)
}

// Layout function with dataset-level grouping: sources on left, targets on right
// Creates group boundary boxes around datasets and their fields
const getLayoutedElements = (nodes, edges) => {

  // Separate by type: source datasets/fields on LEFT, target datasets/fields on RIGHT
  const targetDatasets = nodes.filter(n => n.data?.originalType === 'target_dataset')
  const sourceDatasets = nodes.filter(n => n.data?.originalType === 'source_dataset')
  const targetFields = nodes.filter(n => n.data?.originalType === 'target_field')
  const sourceFields = nodes.filter(n => n.data?.originalType === 'source_field')

  // Group source fields by their parent dataset
  const sourceFieldsByDataset = new Map()
  sourceFields.forEach(field => {
    const parts = field.id.split('.')
    const datasetId = parts.slice(0, -1).join('.')
    if (!sourceFieldsByDataset.has(datasetId)) {
      sourceFieldsByDataset.set(datasetId, [])
    }
    sourceFieldsByDataset.get(datasetId).push(field)
  })

  // Group target fields by their parent dataset
  const targetFieldsByDataset = new Map()
  targetFields.forEach(field => {
    const parts = field.id.split('.')
    const datasetId = parts.slice(0, -1).join('.')
    if (!targetFieldsByDataset.has(datasetId)) {
      targetFieldsByDataset.set(datasetId, [])
    }
    targetFieldsByDataset.get(datasetId).push(field)
  })

  // Layout configuration
  const config = {
    startY: 50,
    fieldHeight: 45,
    datasetHeight: 50,
    groupPadding: 15,
    groupHeaderHeight: 40,
    groupGap: 30,
    sourceX: 50,
    targetX: 600,
    groupWidth: 280,
    fieldWidth: 250,
  }

  const layoutedNodes = []
  let leftY = config.startY
  let rightY = config.startY

  // Track which source datasets have been processed
  const processedSourceDatasets = new Set()

  // Layout SOURCE side (LEFT) - grouped by dataset with boundary boxes
  sourceFieldsByDataset.forEach((fields, datasetId) => {
    // Find corresponding dataset node (could be prefixed with "ds-")
    const datasetNode = sourceDatasets.find(d =>
      d.id === datasetId || d.id === `ds-${datasetId}`
    )

    if (datasetNode && !processedSourceDatasets.has(datasetNode.id)) {
      processedSourceDatasets.add(datasetNode.id)

      // Calculate group height based on fields
      const groupHeight = config.groupHeaderHeight + (fields.length * config.fieldHeight) + config.groupPadding * 2

      // Create group boundary node
      const groupId = `group-${datasetNode.id}`
      layoutedNodes.push({
        id: groupId,
        type: 'group',
        data: { label: '' },
        position: { x: config.sourceX, y: leftY },
        style: {
          width: config.groupWidth,
          height: groupHeight,
          backgroundColor: 'rgba(14, 165, 233, 0.1)',
          border: '2px solid rgba(14, 165, 233, 0.4)',
          borderRadius: '12px',
          padding: 0,
        },
        selectable: false,
        draggable: false,
      })

      // Position dataset header inside group
      layoutedNodes.push({
        ...datasetNode,
        parentId: groupId,
        extent: 'parent',
        targetPosition: 'left',
        sourcePosition: 'right',
        position: { x: config.groupPadding, y: config.groupPadding },
        style: {
          ...datasetNode.style,
          width: config.groupWidth - config.groupPadding * 2,
        },
      })

      // Position fields inside group
      fields.forEach((field, index) => {
        layoutedNodes.push({
          ...field,
          parentId: groupId,
          extent: 'parent',
          targetPosition: 'left',
          sourcePosition: 'right',
          position: {
            x: config.groupPadding,
            y: config.groupHeaderHeight + config.groupPadding + (index * config.fieldHeight)
          },
          style: {
            ...field.style,
            width: config.fieldWidth,
          },
        })
      })

      leftY += groupHeight + config.groupGap
    }
  })

  // Process remaining source datasets without fields
  sourceDatasets.forEach(dataset => {
    if (!processedSourceDatasets.has(dataset.id)) {
      // Create a small group just for the dataset
      const groupId = `group-${dataset.id}`
      const groupHeight = config.datasetHeight + config.groupPadding * 2

      layoutedNodes.push({
        id: groupId,
        type: 'group',
        data: { label: '' },
        position: { x: config.sourceX, y: leftY },
        style: {
          width: config.groupWidth,
          height: groupHeight,
          backgroundColor: 'rgba(14, 165, 233, 0.1)',
          border: '2px solid rgba(14, 165, 233, 0.4)',
          borderRadius: '12px',
          padding: 0,
        },
        selectable: false,
        draggable: false,
      })

      layoutedNodes.push({
        ...dataset,
        parentId: groupId,
        extent: 'parent',
        targetPosition: 'left',
        sourcePosition: 'right',
        position: { x: config.groupPadding, y: config.groupPadding },
        style: {
          ...dataset.style,
          width: config.groupWidth - config.groupPadding * 2,
        },
      })

      leftY += groupHeight + config.groupGap
    }
  })

  // Layout TARGET side (RIGHT) - grouped by dataset with boundary boxes
  targetDatasets.forEach(dataset => {
    const fields = targetFieldsByDataset.get(dataset.id) || []
    const groupHeight = config.groupHeaderHeight + (fields.length * config.fieldHeight) + config.groupPadding * 2

    // Create group boundary node
    const groupId = `group-${dataset.id}`
    layoutedNodes.push({
      id: groupId,
      type: 'group',
      data: { label: '' },
      position: { x: config.targetX, y: rightY },
      style: {
        width: config.groupWidth,
        height: groupHeight,
        backgroundColor: 'rgba(99, 102, 241, 0.1)',
        border: '2px solid rgba(99, 102, 241, 0.4)',
        borderRadius: '12px',
        padding: 0,
      },
      selectable: false,
      draggable: false,
    })

    // Position dataset header inside group
    layoutedNodes.push({
      ...dataset,
      parentId: groupId,
      extent: 'parent',
      targetPosition: 'left',
      sourcePosition: 'right',
      position: { x: config.groupPadding, y: config.groupPadding },
      style: {
        ...dataset.style,
        width: config.groupWidth - config.groupPadding * 2,
      },
    })

    // Position fields inside group
    fields.forEach((field, index) => {
      layoutedNodes.push({
        ...field,
        parentId: groupId,
        extent: 'parent',
        targetPosition: 'left',
        sourcePosition: 'right',
        position: {
          x: config.groupPadding,
          y: config.groupHeaderHeight + config.groupPadding + (index * config.fieldHeight)
        },
        style: {
          ...field.style,
          width: config.fieldWidth,
        },
      })
    })

    rightY += groupHeight + config.groupGap
  })

  // Handle orphan target fields (if any)
  targetFields.forEach(field => {
    if (!layoutedNodes.find(n => n.id === field.id)) {
      layoutedNodes.push({
        ...field,
        targetPosition: 'left',
        sourcePosition: 'right',
        position: { x: config.targetX + config.groupPadding, y: rightY },
      })
      rightY += config.fieldHeight
    }
  })

  return { nodes: layoutedNodes, edges }
}


// Custom node styles with dynamic width support
const nodeStyles = {
  target_dataset: {
    background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '12px',
    padding: '14px 20px',
    fontWeight: '700',
    fontSize: '14px',
    boxShadow: '0 4px 16px rgba(99, 102, 241, 0.4)',
    textAlign: 'center',
    whiteSpace: 'nowrap',
  },
  source_dataset: {
    background: 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '10px',
    padding: '12px 18px',
    fontWeight: '600',
    fontSize: '13px',
    boxShadow: '0 4px 12px rgba(14, 165, 233, 0.3)',
    textAlign: 'center',
    whiteSpace: 'nowrap',
  },
  target_field: {
    background: '#ffffff',
    color: '#1e293b',
    border: '2px solid #10b981',
    borderRadius: '8px',
    padding: '10px 16px',
    fontWeight: '500',
    fontSize: '12px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
    whiteSpace: 'nowrap',
  },
  source_field: {
    background: '#ffffff',
    color: '#1e293b',
    border: '2px solid #a855f7',
    borderRadius: '8px',
    padding: '10px 16px',
    fontWeight: '500',
    fontSize: '12px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
    whiteSpace: 'nowrap',
  },
}

// Edge colors by lineage type
const edgeColors = {
  copied_from: '#10b981',
  calculated_from: '#6366f1',
  derived_from: '#ef4444',
  looked_up_from: '#a855f7',
  depends_on: '#0ea5e9',
}

// Contract Templates
const CONTRACT_TEMPLATES = {
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

function LineageContent() {
  const { flowToScreenPosition } = useReactFlow()
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [datasets, setDatasets] = useState([])
  const [selectedDataset, setSelectedDataset] = useState('')
  const [lineageLevel, setLineageLevel] = useState('field')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Refs for positioning
  // flowWrapperRef and viewportRef removed in favor of useReactFlow

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [showSearchDropdown, setShowSearchDropdown] = useState(false)

  const searchRef = useRef(null)

  // Tooltip delay ref
  const tooltipTimeoutRef = useRef(null)

  // Tooltip state
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, content: null })

  // Panel states
  const [showReconPanel, setShowReconPanel] = useState(false)
  const [showContractPanel, setShowContractPanel] = useState(false)
  const [contracts, setContracts] = useState([])
  const [reconResults, setReconResults] = useState(null)

  // Selection state for lineage highlighting
  const [selectedNode, setSelectedNode] = useState(null)

  // Contract modal state
  const [showContractModal, setShowContractModal] = useState(false)
  const [editingContract, setEditingContract] = useState(null) // null = create mode, object = edit mode
  const [contractForm, setContractForm] = useState({
    type: 'lineage',
    content: ''
  })
  const [contractSaving, setContractSaving] = useState(false)
  const [contractSearchQuery, setContractSearchQuery] = useState('')
  const [commitMessage, setCommitMessage] = useState('')
  const [validationErrors, setValidationErrors] = useState([])
  const [validationSuccess, setValidationSuccess] = useState(false)

  // Recocniliation UX State
  const [reconTab, setReconTab] = useState('lineage') // 'lineage' or 'dataset'
  const [availableReconChecks, setAvailableReconChecks] = useState([])
  const [selectedReconChecks, setSelectedReconChecks] = useState(new Set())
  const [selectedFields, setSelectedFields] = useState(new Set())
  const [reconSearchQuery, setReconSearchQuery] = useState('')

  const [executionParams, setExecutionParams] = useState({})

  // Get target fields for current dataset
  const currentTargetFields = useMemo(() => {
    if (!selectedDataset) return []
    // Find fields where ID starts with selectedDataset and type is target_field
    let fields = nodes.filter(n =>
      n.data?.originalType === 'target_field' &&
      n.id.startsWith(`${selectedDataset}.`) &&
      n.data?.hasValidation // Only show fields with validation logic
    ).map(n => ({
      name: n.data.label,
      id: n.id,
      parameters: n.data?.parameters || []
    }))

    if (reconSearchQuery) {
      const q = reconSearchQuery.toLowerCase()
      fields = fields.filter(f => f.name.toLowerCase().includes(q))
    }
    return fields
  }, [selectedDataset, nodes, reconSearchQuery])

  const filteredReconChecks = useMemo(() => {
    if (!reconSearchQuery) return availableReconChecks
    const q = reconSearchQuery.toLowerCase()
    return availableReconChecks.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.description && c.description.toLowerCase().includes(q))
    )
  }, [availableReconChecks, reconSearchQuery])

  // Calculate active parameters based on selection and tab
  const activeParameters = useMemo(() => {
    const paramsMap = new Map()

    if (reconTab === 'lineage') {
      // Collect params from selected fields
      selectedFields.forEach(fieldName => {
        // Find field in currentTargetFields (which has params from node data ref)
        const field = currentTargetFields.find(f => f.name === fieldName)
        if (field?.parameters) {
          field.parameters.forEach(p => paramsMap.set(p.name, p))
        }
      })
    } else {
      // Collect params from selected recon checks
      selectedReconChecks.forEach(checkName => {
        const check = availableReconChecks.find(c => c.name === checkName)
        if (check?.parameters) {
          check.parameters.forEach(p => paramsMap.set(p.name, p))
        }
      })
    }
    return Array.from(paramsMap.values())
  }, [reconTab, selectedFields, selectedReconChecks, currentTargetFields, availableReconChecks])

  // Update execution params default values when active params change
  useEffect(() => {
    setExecutionParams(prev => {
      const next = { ...prev }
      activeParameters.forEach(p => {
        if (next[p.name] === undefined && p.default !== undefined) {
          next[p.name] = p.default
        }
      })
      return next
    })
  }, [activeParameters])

  // Reset selections when dataset changes
  useEffect(() => {
    setSelectedFields(new Set())
    setSelectedReconChecks(new Set())
    setAvailableReconChecks([])
    setReconResults(null)

    if (selectedDataset) {
      // Auto-fetch available recon checks
      const parts = selectedDataset.split('.')
      if (parts.length >= 2) {
        const layer = parts[0].replace('DW_', '').toLowerCase()
        const name = parts.slice(1).join('.').toLowerCase()
        fetch(`${API_BASE}/contracts/recon/${layer}/${name}`)
          .then(res => {
            if (res.ok) return res.json()
            return null
          })
          .then(data => {
            if (data?.content?.validations) {
              setAvailableReconChecks(data.content.validations)
            }
          })
          .catch(() => {
            // No recon contract found, that's fine
            setAvailableReconChecks([])
          })
      }
    }
  }, [selectedDataset])

  // Filter contracts based on search query
  const filteredContracts = useMemo(() => {
    if (!contractSearchQuery.trim()) return contracts
    const query = contractSearchQuery.toLowerCase()
    return contracts.filter(c =>
      c.name?.toLowerCase().includes(query) ||
      c.type?.toLowerCase().includes(query) ||
      c.layer?.toLowerCase().includes(query) ||
      c.target?.toLowerCase().includes(query)
    )
  }, [contracts, contractSearchQuery])

  // Fetch datasets and contracts on mount
  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/datasets`).then(res => res.json()),
      fetch(`${API_BASE}/contracts`).then(res => res.json())
    ])
      .then(([datasetsData, contractsData]) => {
        // Filter datasets to only those with any contract (lineage, recon, or dataset)
        const allContracts = contractsData.contracts || []
        const validTargets = new Set(allContracts.map(c => c.target).filter(Boolean))

        // Filter datasets that match contract targets by id or name
        const allDatasets = datasetsData.datasets || []
        const filteredDatasets = allDatasets.filter(d =>
          validTargets.has(d.id) || validTargets.has(d.name)
        )

        // Only show datasets with contracts, never fallback to all
        setDatasets(filteredDatasets)
        setContracts(allContracts)
      })
      .catch((err) => {
        console.error('Failed to load initial data:', err)
        setError(`Failed to load data: ${err.message}`)
      })
  }, [])

  // Search functionality with debounce
  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([])
      return
    }

    const timer = setTimeout(() => {
      fetch(`${API_BASE}/search?q=${encodeURIComponent(searchQuery)}`)
        .then(res => res.json())
        .then(data => {
          // Deduplicate search results by unique ID
          const seen = new Set()
          const uniqueResults = (data.results || []).filter(result => {
            const key = result.id
            if (seen.has(key)) return false
            seen.add(key)
            return true
          })
          setSearchResults(uniqueResults)
          setShowSearchDropdown(true)
        })
        .catch(() => setSearchResults([]))
    }, 300)

    return () => clearTimeout(timer)
  }, [searchQuery])

  // Load lineage for selected dataset
  const loadLineage = useCallback(async () => {
    if (!selectedDataset) return

    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`${API_BASE}/lineage/${selectedDataset}?level=${lineageLevel}`)
      const data = await res.json()

      // Deduplicate nodes by ID
      const uniqueNodesMap = new Map()
        ; (data.nodes || []).forEach(node => {
          if (!uniqueNodesMap.has(node.id)) {
            uniqueNodesMap.set(node.id, node)
          }
        })
      const uniqueNodes = Array.from(uniqueNodesMap.values())

      // Deduplicate edges by ID
      const uniqueEdgesMap = new Map()
        ; (data.edges || []).forEach(edge => {
          if (!uniqueEdgesMap.has(edge.id)) {
            uniqueEdgesMap.set(edge.id, edge)
          }
        })
      const uniqueEdges = Array.from(uniqueEdgesMap.values())

      // Style edges based on lineage type
      const styledEdges = uniqueEdges.map(edge => ({
        ...edge,
        style: {
          stroke: edgeColors[edge.type] || '#94a3b8',
          strokeWidth: 2,
        },
        type: 'default',
        animated: true,
        label: edge.type?.replace(/_/g, ' ').toUpperCase(),
        labelStyle: { fontSize: 10, fill: '#64748b', fontWeight: 500 },
        labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9 },
      }))

      // Prepare nodes for layout
      const initialNodes = uniqueNodes.map(n => {
        const isTarget = n.type === 'target_dataset' || n.type === 'target_field'
        const label = n.data?.label || n.id
        const nodeWidth = calculateNodeWidth(label)

        return {
          ...n,
          data: {
            ...n.data,
            originalType: n.type,
            column: isTarget ? 0 : -1
          },
          style: {
            ...nodeStyles[n.type] || nodeStyles.source_field,
            width: nodeWidth,
          },
          type: 'default'
        }
      })

      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
        initialNodes,
        styledEdges
      )

      setNodes(layoutedNodes)
      setEdges(layoutedEdges)
    } catch (err) {
      console.error(err)
      setError(err.message)
      toast.error('Failed to load lineage')
    } finally {
      setLoading(false)
    }
  }, [selectedDataset, lineageLevel, setNodes, setEdges])

  // Context Menu State
  const [contextMenu, setContextMenu] = useState(null)

  // Expand Logic (Drill Down)
  const expandNode = useCallback(async (node) => {
    try {
      toast.info(`Fetching dependencies for ${node.data.label}...`)

      const res = await fetch(`${API_BASE}/lineage/field/${node.id}`)
      if (!res.ok) throw new Error('Failed to fetch dependency lineage')

      const data = await res.json()

      if (data.nodes.length === 0) {
        toast.info('No further dependencies found')
        setNodes(nds => nds.map(n => n.id === node.id ? { ...n, data: { ...n.data, expanded: true } } : n))
        return
      }

      // Calculate position for new layer
      const currentColumn = node.data?.column || -1
      const newColumn = currentColumn - 1
      const xPos = node.position.x - 450
      let yPos = node.position.y - 50

      // Process new nodes
      const newNodesByDataset = new Map()
      const newDatasetNodes = []

      data.nodes.forEach(n => {
        if (n.type === 'source_dataset') {
          newDatasetNodes.push(n)
        } else {
          if (!newNodesByDataset.has(n.data.dataset)) {
            newNodesByDataset.set(n.data.dataset, [])
          }
          newNodesByDataset.get(n.data.dataset).push(n)
        }
      })

      const nodesToAdd = []

      newDatasetNodes.forEach(dsNode => {
        const fields = newNodesByDataset.get(dsNode.data.fullName) || []
        const groupHeight = 40 + (fields.length * 45) + 30
        const groupId = `group-${dsNode.id}`

        // Group Box
        nodesToAdd.push({
          id: groupId,
          type: 'group',
          data: { label: '' },
          position: { x: xPos, y: yPos },
          style: {
            width: 280,
            height: groupHeight,
            backgroundColor: 'rgba(14, 165, 233, 0.1)',
            border: '2px solid rgba(14, 165, 233, 0.4)',
            borderRadius: '12px',
            zIndex: -1
          },
          selectable: false
        })

        // Dataset Header
        const dsWidth = calculateNodeWidth(dsNode.data.label)
        nodesToAdd.push({
          ...dsNode,
          id: dsNode.id,
          parentId: groupId,
          extent: 'parent',
          position: { x: 15, y: 15 },
          style: {
            ...nodeStyles['source_dataset'],
            width: dsWidth
          },
          data: { ...dsNode.data, column: newColumn, originalType: 'source_dataset' },
          type: 'default'
        })

        // Fields
        fields.forEach((field, i) => {
          const fieldWidth = calculateNodeWidth(field.data.label)
          nodesToAdd.push({
            ...field,
            parentId: groupId,
            extent: 'parent',
            position: { x: 15, y: 55 + (i * 45) },
            style: {
              ...nodeStyles['source_field'],
              width: fieldWidth
            },
            data: { ...field.data, column: newColumn, originalType: 'source_field' },
            type: 'default'
          })
        })

        yPos += groupHeight + 30
      })

      setNodes(nds => {
        const updatedOldNodes = nds.map(n => n.id === node.id ? { ...n, data: { ...n.data, expanded: true } } : n)
        const existingIds = new Set(updatedOldNodes.map(n => n.id))
        const uniqueNewNodes = nodesToAdd.filter(n => !existingIds.has(n.id))
        return [...updatedOldNodes, ...uniqueNewNodes]
      })

      setEdges(eds => {
        const existingIds = new Set(eds.map(e => e.id))
        const stylizedNewEdges = data.edges.map(e => ({
          ...e,
          style: {
            stroke: edgeColors[e.type] || '#94a3b8',
            strokeWidth: 2,
          },
          type: 'default',
          animated: true,
          label: e.type?.replace(/_/g, ' ').toUpperCase(),
          labelStyle: { fontSize: 10, fill: '#64748b', fontWeight: 500 },
          labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9 },
        }))

        const uniqueNewEdges = stylizedNewEdges.filter(e => !existingIds.has(e.id))
        return [...eds, ...uniqueNewEdges]
      })

      toast.success('Expanded dependencies')

    } catch (err) {
      console.error(err)
      toast.error('Failed to expand dependencies')
    }
  }, [setNodes, setEdges])

  // Collapse Logic
  const collapseNode = useCallback((node) => {
    // Recursive function to gather all upstream nodes/edges
    const nodesToRemove = new Set()
    const edgesToRemove = new Set()
    const groupsToRemove = new Set()

    const traverseUpstream = (targetId) => {
      // Find edges pointing to this target
      // edges is captured from closure, needs to be updated or passed?
      // We need current state of edges. We will stick to setNodes functional update to get latest?
      // Actually simpler: we can't do recursive deletion easily inside a functional update without access to full graph.
      // We will assume "edges" state is relatively fresh or use a helper that accesses current nodes/edges.
      // But 'collapseNode' is a callback. 'edges' and 'nodes' should be dependencies.
      // Refactor: We need 'nodes' and 'edges' in dependency array.
      const upstreamEdges = edges.filter(e => e.target === targetId)

      upstreamEdges.forEach(edge => {
        edgesToRemove.add(edge.id)
        const sourceId = edge.source

        if (!nodesToRemove.has(sourceId)) {
          nodesToRemove.add(sourceId)
          // If source is a dataset header, mark its group
          const sourceNode = nodes.find(n => n.id === sourceId)
          if (sourceNode?.data?.originalType === 'source_dataset') {
            groupsToRemove.add(`group-${sourceId}`)
          }
          // Recurse
          traverseUpstream(sourceId)
        }
      })
    }

    traverseUpstream(node.id)

    setNodes(nds => nds.filter(n => !nodesToRemove.has(n.id) && !groupsToRemove.has(n.id))
      .map(n => n.id === node.id ? { ...n, data: { ...n.data, expanded: false } } : n))
    setEdges(eds => eds.filter(e => !edgesToRemove.has(e.id)))

    toast.info('Collapsed dependencies')
  }, [nodes, edges, setNodes, setEdges])


  // Updated Node Click Handler -> Opens Menu Attached to Node
  const onNodeClick = useCallback((event, node) => {
    // 1. Selection
    setSelectedNode((prev) => (prev === node.id ? null : node.id))

    // 2. Context Menu
    const isSourceField = node.type === 'source_field' || node.data?.originalType === 'source_field'
    if (isSourceField) {
      event.preventDefault()

      // Node is likely inside a group, so we need absolute position
      // React Flow v12+ nodes often have computed.positionAbsolute or just positionAbsolute
      // Fallback to position if not grouped
      const absX = node.computed?.positionAbsolute?.x ?? node.positionAbsolute?.x ?? node.position.x
      const absY = node.computed?.positionAbsolute?.y ?? node.positionAbsolute?.y ?? node.position.y

      const nodeWidth = node.measured?.width ?? node.width ?? calculateNodeWidth(node.data.label)

      // Get screen position of the top-right corner of the node
      const screenPos = flowToScreenPosition({
        x: absX + nodeWidth,
        y: absY
      })

      setContextMenu({
        visible: true,
        x: screenPos.x + 10,
        y: screenPos.y,
        node: node
      })
    }
  }, [flowToScreenPosition])

  // Close menu on click elsewhere
  const onPaneClick = useCallback(() => {
    setContextMenu(null)
  }, [])

  // Auto-load when dataset or level changes
  useEffect(() => {
    if (selectedDataset) {
      loadLineage()
    }
  }, [selectedDataset, lineageLevel, loadLineage])

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge(params, eds)),
    [setEdges],
  )

  // Handle search result selection
  const handleSearchSelect = (result) => {
    if (result.type === 'dataset') {
      setSelectedDataset(result.id)
    } else if (result.type === 'field') {
      setSelectedDataset(result.datasetId)
    }
    setSearchQuery('')
    setShowSearchDropdown(false)
  }

  // Node hover handlers
  const onNodeMouseEnter = useCallback((event, node) => {
    // Clear any pending hide timer
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current)
      tooltipTimeoutRef.current = null
    }
    // Ignore group nodes
    if (node.type === 'group') return

    const rect = event.target.getBoundingClientRect()
    setTooltip({
      visible: true,
      x: rect.right + 10,
      y: rect.top,
      content: node.data,
      nodeType: node.type
    })
  }, [])

  const onNodeMouseLeave = useCallback(() => {
    // Add delay before hiding tooltip
    tooltipTimeoutRef.current = setTimeout(() => {
      setTooltip(prev => ({ ...prev, visible: false }))
    }, 300)
  }, [])

  // Highlight connected edges when a node is selected
  useEffect(() => {
    if (!selectedNode) {
      // Reset all edges to normal
      setEdges((eds) =>
        eds.map((edge) => ({
          ...edge,
          style: {
            ...edge.style,
            strokeWidth: 2,
            opacity: 1,
          },
          animated: true,
        }))
      )
      return
    }

    setEdges((eds) =>
      eds.map((edge) => {
        const isConnected = edge.source === selectedNode || edge.target === selectedNode
        return {
          ...edge,
          style: {
            ...edge.style,
            strokeWidth: isConnected ? 4 : 1,
            opacity: isConnected ? 1 : 0.3,
          },
          animated: isConnected,
          zIndex: isConnected ? 1000 : 0,
        }
      })
    )
  }, [selectedNode, setEdges])

  // Load contracts
  const loadContracts = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/contracts`)
      const data = await res.json()
      setContracts(data.contracts || [])
    } catch (err) {
      console.error('Failed to load contracts', err)
    }
  }, [])

  // Run reconciliation
  const runReconciliation = useCallback(async () => {
    if (!selectedDataset) return

    setLoading(true)
    setReconResults(null) // clear previous

    try {
      let endpoint = ''
      let body = {}

      if (reconTab === 'lineage') {
        endpoint = `${API_BASE}/validate/reverse-match`
        // If nothing selected, run ALL (legacy behavior) OR handle as error?
        // Let's mimic legacy: if empty set, send null to run all?
        // Or better: enforce selection. User asked for "specific field".
        // Use all fields if list is empty for backward compat or UX ease?
        // Let's send specific fields if any are selected.
        const fieldsToRun = selectedFields.size > 0 ? Array.from(selectedFields) : null
        body = { dataset: selectedDataset, fields: fieldsToRun, parameters: executionParams }
      } else {
        endpoint = `${API_BASE}/validate/recon`
        const checksToRun = selectedReconChecks.size > 0 ? Array.from(selectedReconChecks) : null
        body = { dataset: selectedDataset, fields: checksToRun, parameters: executionParams }
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (!res.ok) {
        const errorText = await res.text()
        try {
          const errorJson = JSON.parse(errorText)
          throw new Error(errorJson.detail || errorJson.error || `Server Error: ${res.status} ${res.statusText}`)
        } catch (e) {
          if (e.message && e.message.startsWith('Server Error')) throw e
          throw new Error(`Server Error: ${res.status} ${res.statusText} - ${errorText.substring(0, 100)}`)
        }
      }
      const data = await res.json()
      setReconResults(data)
    } catch (err) {
      console.error('Reconciliation error:', err)
      setReconResults({ error: err.message || 'Failed to run reconciliation' })
    } finally {
      setLoading(false)
    }
  }, [selectedDataset, reconTab, selectedFields, selectedReconChecks, executionParams])


  // Toggle helpers
  const toggleField = (fieldName) => {
    const next = new Set(selectedFields)
    if (next.has(fieldName)) next.delete(fieldName)
    else next.add(fieldName)
    setSelectedFields(next)
  }

  const toggleReconCheck = (checkName) => {
    const next = new Set(selectedReconChecks)
    if (next.has(checkName)) next.delete(checkName)
    else next.add(checkName)
    setSelectedReconChecks(next)
  }

  const selectAllFields = () => {
    if (selectedFields.size === currentTargetFields.length) {
      setSelectedFields(new Set())
    } else {
      setSelectedFields(new Set(currentTargetFields.map(f => f.name)))
    }
  }

  const selectAllRecon = () => {
    if (selectedReconChecks.size === availableReconChecks.length) {
      setSelectedReconChecks(new Set())
    } else {
      setSelectedReconChecks(new Set(availableReconChecks.map(c => c.name)))
    }
  }







  // Open create contract modal
  const openCreateModal = useCallback(() => {
    setEditingContract(null)
    setContractForm({
      type: 'lineage',
      content: CONTRACT_TEMPLATES.lineage
    })
    setShowContractModal(true)
    setCommitMessage('')
    setValidationErrors([])
    setValidationSuccess(false)
  }, [])

  // Open edit contract modal
  const openEditModal = useCallback(async (contract) => {
    try {
      const res = await fetch(`${API_BASE}/contracts/${contract.type}/${contract.layer}/${contract.name}`)
      const data = await res.json()

      // Convert the content object to proper YAML string using js-yaml
      const yamlContent = yaml.dump(data.content, {
        indent: 2,
        lineWidth: -1, // Don't wrap lines
        noRefs: true,
        quotingType: '"',
        forceQuotes: false
      })

      setEditingContract(contract)
      setContractForm({
        type: contract.type,
        content: yamlContent
      })
      setCommitMessage('')
      setValidationErrors([])
      setValidationSuccess(false)
      setShowContractModal(true)
    } catch (err) {
      console.error('Failed to load contract:', err)
      toast.error('Failed to load contract for editing')
    }
  }, [])

  // Validate contract content
  const validateContract = useCallback(async () => {
    setValidationErrors([])
    setValidationSuccess(false)
    try {
      const res = await fetch(`${API_BASE}/contracts/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contract_type: contractForm.type,
          content: contractForm.content
        })
      })
      const data = await res.json()
      if (!data.valid) {
        setValidationErrors(data.errors || ['Unknown validation error'])
        return false
      }
      setValidationSuccess(true)
      return true
    } catch (err) {
      console.error('Validation error:', err)
      setValidationErrors([`Validation request failed: ${err.message}`])
      return false
    }
  }, [contractForm])

  // Save contract (validate -> draft -> submit)
  const saveContract = useCallback(async () => {
    // 1. Validate first
    const isValid = await validateContract()
    if (!isValid) return

    // 2. Check commit message
    if (!commitMessage.trim()) {
      toast.warning('Please enter a commit message to save changes.')
      return
    }

    setContractSaving(true)
    try {
      // Parse YAML content using js-yaml library to ensure it's valid dict
      // (This is redundant if validation passed, but good for safety before parsing for draft meta)
      const content = yaml.load(contractForm.content)

      // 3. Save as Draft
      // If editing, we should pass original path info if we had it, but for now relying on logic
      const draftRes = await fetch(`${API_BASE}/contracts/${contractForm.type}/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: content,
          original_path: editingContract ? `${editingContract.layer}/${editingContract.name}` : null
          // Note: Backend stores simplistic original_path, mainly for reference/audit in draft
        })
      })

      if (!draftRes.ok) throw new Error('Failed to save draft')
      const draftData = await draftRes.json()

      // 4. Submit Draft
      const submitRes = await fetch(`${API_BASE}/contracts/draft/${draftData.draft_id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commit_message: commitMessage
        })
      })

      if (!submitRes.ok) {
        const errData = await submitRes.json()
        throw new Error(errData.detail || 'Failed to submit contract')
      }

      setShowContractModal(false)
      loadContracts()
      setCommitMessage('')
      toast.success('Contract saved successfully')
    } catch (err) {
      console.error('Save error:', err)
      toast.error(`Failed to save contract: ${err.message}`)
    } finally {
      setContractSaving(false)
    }
  }, [contractForm, editingContract, loadContracts, commitMessage, validateContract])


  return (
    <div className="app">
      <Toaster richColors position="top-right" />
      <header className="header">
        <h1>🔗 Data Lineage Explorer</h1>
        <div className="controls">
          {/* Search Input */}
          <div className="search-container" ref={searchRef}>
            <input
              type="text"
              className="search-input"
              placeholder="Search datasets or fields..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => searchQuery.length >= 2 && setShowSearchDropdown(true)}
              onBlur={() => setTimeout(() => setShowSearchDropdown(false), 200)}
            />
            {showSearchDropdown && searchResults.length > 0 && (
              <div className="search-dropdown">
                {searchResults.map((result, idx) => (
                  <div
                    key={result.id || idx}
                    className="search-result"
                    onClick={() => handleSearchSelect(result)}
                    title={result.type === 'field'
                      ? `Field: ${result.name}\nDataset: ${result.datasetName || result.datasetId}\nID: ${result.id}`
                      : `Dataset: ${result.name}\nLayer: ${result.layer || 'N/A'}\nDomain: ${result.domain || 'N/A'}\nID: ${result.id}`
                    }
                  >
                    <span className={`result-type ${result.type}`}>
                      {result.type === 'dataset' ? '📊' : '📋'}
                    </span>
                    <span className="result-name">{result.name}</span>
                    {result.type === 'field' && (
                      <span className="result-dataset" title={result.datasetName}>{result.datasetName}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Level Toggle */}
          <div className="level-toggle">
            <button
              className={`level-btn ${lineageLevel === 'dataset' ? 'active' : ''}`}
              onClick={() => setLineageLevel('dataset')}
            >
              Dataset
            </button>
            <button
              className={`level-btn ${lineageLevel === 'field' ? 'active' : ''}`}
              onClick={() => setLineageLevel('field')}
            >
              Field
            </button>
          </div>

          {/* Dataset Select */}
          <select
            value={selectedDataset}
            onChange={(e) => setSelectedDataset(e.target.value)}
            className="dataset-select"
          >
            <option value="">Select a dataset...</option>
            {datasets.map(d => (
              <option key={d.id} value={d.id}>{d.name} ({d.layer})</option>
            ))}
          </select>

          {/* Action Buttons */}
          <button
            onClick={() => { setShowReconPanel(!showReconPanel); setShowContractPanel(false) }}
            className={`action-btn ${showReconPanel ? 'active' : ''}`}
            disabled={!selectedDataset}
          >
            ⚡ Reconcile
          </button>
          <button
            onClick={() => { setShowContractPanel(!showContractPanel); setShowReconPanel(false); loadContracts() }}
            className={`action-btn ${showContractPanel ? 'active' : ''}`}
          >
            📄 Contracts
          </button>
        </div>
      </header>

      {error && <div className="error">{error}</div>}
      {loading && <div className="loading">Loading lineage...</div>}

      <div className="main-content">
        <div className="flow-container">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeMouseEnter={onNodeMouseEnter}
            onNodeMouseLeave={onNodeMouseLeave}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            attributionPosition="bottom-left"
          >
            <Controls position="bottom-left" />
            <MiniMap
              position="bottom-right"
              nodeColor={(node) => {
                const type = node.data?.originalType || node.type
                return type === 'target_dataset' ? '#6366f1' :
                  type === 'source_dataset' ? '#0ea5e9' :
                    type === 'source_field' ? '#a855f7' : '#10b981'
              }}
              maskColor="rgba(0, 0, 0, 0.05)"
            />
            <Background variant="dots" gap={24} size={1} color="#cbd5e1" />
            <Panel position="top-right" className="legend">
              <div><span className="dot copied"></span> Copied From</div>
              <div><span className="dot calculated"></span> Calculated From</div>
              <div><span className="dot derived"></span> Derived From</div>
              <div><span className="dot looked"></span> Looked Up From</div>
              <div><span className="dot depends"></span> Depends On</div>
            </Panel>
          </ReactFlow>
        </div>

        {/* Tooltip */}
        {tooltip.visible && tooltip.content && (
          <div
            className="node-tooltip extended"
            style={{ left: tooltip.x, top: tooltip.y }}
            onMouseEnter={() => {
              if (tooltipTimeoutRef.current) {
                clearTimeout(tooltipTimeoutRef.current);
                tooltipTimeoutRef.current = null;
              }
            }}
            onMouseLeave={() => {
              tooltipTimeoutRef.current = setTimeout(() => {
                setTooltip({ visible: false, content: null });
              }, 800);
            }}
          >
            {/* Header */}
            <div className="tooltip-header-full">
              <span className="tooltip-title">{tooltip.content.label}</span>
              <span className={`tooltip-type-badge ${tooltip.content.layer || 'field'}`}>
                {tooltip.content.layer || (tooltip.content.data_type ? 'FIELD' : 'DATASET')}
              </span>
            </div>

            <div className="tooltip-body">
              {/* Dataset Specifics */}
              {tooltip.content.domain && (
                <div className="tooltip-section">
                  <div className="tooltip-row"><strong>Domain:</strong> {tooltip.content.domain}</div>
                </div>
              )}

              {tooltip.content.owner && (
                <div className="tooltip-section">
                  <div className="tooltip-row"><strong>Owner:</strong> {tooltip.content.owner.team || 'N/A'}</div>
                  {tooltip.content.owner.email && <div className="tooltip-row sub-text">{tooltip.content.owner.email}</div>}
                </div>
              )}

              {tooltip.content.primary_keys && (
                <div className="tooltip-section">
                  <div className="tooltip-row">
                    <strong>Primary Keys:</strong>
                    <span className="pk-badge">{tooltip.content.primary_keys.join(', ')}</span>
                  </div>
                </div>
              )}

              {tooltip.content.classification && (
                <div className="tooltip-section">
                  <div className="tooltip-row">
                    <strong>Confidential:</strong>
                    <span className={tooltip.content.classification.confidential ? 'tag-yes' : 'tag-no'}>
                      {tooltip.content.classification.confidential ? 'YES' : 'NO'}
                    </span>
                  </div>
                  <div className="tooltip-row">
                    <strong>PII:</strong>
                    <span className={tooltip.content.classification.pii ? 'tag-yes' : 'tag-no'}>
                      {tooltip.content.classification.pii ? 'YES' : 'NO'}
                    </span>
                  </div>
                </div>
              )}

              {/* Field Specifics */}
              {tooltip.content.data_type && (
                <div className="tooltip-section">
                  <div className="tooltip-row"><strong>Type:</strong> {tooltip.content.data_type}</div>
                  <div className="tooltip-row">
                    <strong>Nullable:</strong> {tooltip.content.nullable ? 'Yes' : 'No'}
                    <span className="separator">|</span>
                    <strong>Adjustable:</strong> {tooltip.content.adjustable ? 'Yes' : 'No'}
                  </div>
                </div>
              )}

              {/* Valid Values & Samples */}
              {(tooltip.content.valid_values || tooltip.content.sample_values) && (
                <div className="tooltip-section">
                  {tooltip.content.valid_values && (
                    <div className="tooltip-row wrap-row">
                      <strong>Valid Values:</strong>
                      <div className="tag-list">
                        {tooltip.content.valid_values.map((v, i) => (
                          <span key={i} className="value-tag">{v}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {tooltip.content.sample_values && (
                    <div className="tooltip-row wrap-row">
                      <strong>Samples:</strong>
                      <div className="sample-text">
                        {tooltip.content.sample_values.join(', ')}
                      </div>
                    </div>
                  )}
                </div>
              )}



              {/* Description */}
              {tooltip.content.description && (
                <div className="tooltip-section description">
                  {tooltip.content.description}
                </div>
              )}

              {/* Lineage & Validation */}
              {(tooltip.content.lineageType || tooltip.content.sources?.length > 0) && (
                <div className="tooltip-section lineage-info">
                  {tooltip.content.lineageType && (
                    <div className="tooltip-row" style={{ marginBottom: '4px' }}>
                      <strong>Lineage:</strong> {tooltip.content.lineageType.replace(/_/g, ' ')}
                    </div>
                  )}

                  {tooltip.content.sources?.length > 0 && (() => {
                    const seen = new Set()
                    const uniqueSources = tooltip.content.sources.filter(s => {
                      const key = `${s.field_name}|${s.dataset}`
                      if (seen.has(key)) return false
                      seen.add(key)
                      return true
                    })
                    return (
                      <div className="tooltip-sources-list">
                        <strong>Sources:</strong>
                        <ul>
                          {uniqueSources.slice(0, 5).map((s, i) => (
                            <li key={i}>{s.field_name} ({s.dataset?.split('.').pop()})</li>
                          ))}
                        </ul>
                      </div>
                    )
                  })()}
                </div>
              )}

              {/* Validation Query Box */}
              {tooltip.content.validationQuery && (
                <div className="validation-query-box">
                  <div className="query-header">
                    <span>✅ Validation Query</span>
                    <button
                      className="copy-btn-mini"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(tooltip.content.validationQuery);
                        toast.success('Query copied to clipboard');
                      }}
                    >
                      Copy
                    </button>
                  </div>
                  <pre className="query-preview">
                    {tooltip.content.validationQuery}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Reconciliation Panel */}
        {showReconPanel && selectedDataset && (
          <div className="side-panel wide">
            <div className="panel-header">
              <h3>⚡ Reconciliation</h3>
              <button onClick={() => setShowReconPanel(false)} className="close-btn">×</button>
            </div>
            <div className="panel-content">
              <div className="panel-info">
                Verify data integrity for <strong>{selectedDataset}</strong>.
              </div>

              {/* Tabs */}
              <div className="tab-group">
                <button
                  className={`tab-btn ${reconTab === 'lineage' ? 'active' : ''}`}
                  onClick={() => { setReconTab('lineage'); setReconResults(null); }}
                >
                  Field Lineage (Reverse Match)
                </button>
                <button
                  className={`tab-btn ${reconTab === 'dataset' ? 'active' : ''}`}
                  onClick={() => { setReconTab('dataset'); setReconResults(null); }}
                >
                  Dataset KPIs
                </button>
              </div>

              {/* Search Box */}
              <div className="contract-search" style={{ marginBottom: '12px' }}>
                <input
                  type="text"
                  className="contract-search-input"
                  placeholder={`Search ${reconTab === 'lineage' ? 'fields' : 'checks'}...`}
                  value={reconSearchQuery}
                  onChange={(e) => setReconSearchQuery(e.target.value)}
                />
                {reconSearchQuery && (
                  <button
                    className="clear-search-btn"
                    onClick={() => setReconSearchQuery('')}
                  >
                    ×
                  </button>
                )}
              </div>

              {reconTab === 'lineage' ? (
                <>
                  <div className="selection-header">
                    <span>Target Fields</span>
                    <div className="selection-actions">
                      <button className="text-btn" onClick={selectAllFields}>
                        {selectedFields.size === currentTargetFields.length ? 'Deselect All' : 'Select All'}
                      </button>
                    </div>
                  </div>
                  <div className="results-list">
                    {currentTargetFields.length === 0 ? (
                      <div className="no-contracts">
                        No fields with validation logic found.<br />
                        <small>Add `validation_query` to attributes in lineage contract.</small>
                      </div>
                    ) : (
                      currentTargetFields.map(field => (
                        <label key={field.name} className={`checkbox-wrapper ${selectedFields.has(field.name) ? 'selected' : ''}`}>
                          <input
                            type="checkbox"
                            className="checkbox-input"
                            checked={selectedFields.has(field.name)}
                            onChange={() => toggleField(field.name)}
                          />
                          <div className="checkbox-content">
                            <div className="field-name">{field.name}</div>
                          </div>
                        </label>
                      ))
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="selection-header">
                    <span>Reconciliation Checks</span>
                    <div className="selection-actions">
                      <button className="text-btn" onClick={selectAllRecon}>
                        {selectedReconChecks.size === filteredReconChecks.length && filteredReconChecks.length > 0 ? 'Deselect All' : 'Select All'}
                      </button>
                    </div>
                  </div>
                  <div className="results-list">
                    {filteredReconChecks.length === 0 ? (
                      <div className="no-contracts">
                        {availableReconChecks.length === 0 ? (
                          <>No reconciliation contract found.<br /><small>Create a .recon.yaml to add checks.</small></>
                        ) : (
                          'No checks match your search.'
                        )}
                      </div>
                    ) : (
                      filteredReconChecks.map(check => (
                        <label key={check.name} className={`checkbox-wrapper ${selectedReconChecks.has(check.name) ? 'selected' : ''}`}>
                          <input
                            type="checkbox"
                            className="checkbox-input"
                            checked={selectedReconChecks.has(check.name)}
                            onChange={() => toggleReconCheck(check.name)}
                          />
                          <div className="checkbox-content">
                            <div className="field-name">{check.name}</div>
                            {check.description && <div className="recon-desc">{check.description}</div>}
                          </div>
                        </label>
                      ))
                    )}
                  </div>
                </>
              )}

              {/* Parameter Inputs */}
              {activeParameters.length > 0 && (
                <div className="params-section">
                  <div className="section-title">Parameters</div>
                  <div className="params-grid">
                    {activeParameters.map(param => (
                      <div key={param.name} className="param-item">
                        <label className="param-label">{param.prompt || param.name}</label>
                        <input
                          type={
                            param.type === 'NUMBER' ? 'number' :
                              param.type === 'DATE' ? 'date' :
                                'text'
                          }
                          className="param-input"
                          value={executionParams[param.name] || ''}
                          onChange={(e) => setExecutionParams(prev => ({ ...prev, [param.name]: e.target.value }))}
                          placeholder={param.default}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}


              <button className="run-btn" onClick={runReconciliation} disabled={loading}>
                {loading ? 'Running...' : `Run ${reconTab === 'lineage' ? 'Reverse Match' : 'Dataset Checks'}`}
              </button>

              {reconResults && (
                <div className="recon-results">
                  <h4>Results for {reconResults.dataset}</h4>
                  {reconResults.error ? (
                    <div className="error-msg">{reconResults.error}</div>
                  ) : (
                    <div className="results-list">
                      {reconResults.results && reconResults.results.map((res, i) => (
                        <div key={i} className="result-block">
                          <div className="result-item">
                            <span className="field-name">{res.field}</span>
                            {res.type && (
                              <span className="lineage-type">
                                {res.type.replace(/_/g, ' ')}
                              </span>
                            )}
                            <span className={`status-badge ${res.status?.toLowerCase() || 'pending'}`}>
                              {res.status || 'PENDING'}
                            </span>
                          </div>

                          {/* Error Message */}
                          {(res.status === 'ERROR' || res.status === 'FAIL') && res.message && (
                            <div className="error-msg" style={{ marginTop: '4px', paddingLeft: '4px', fontSize: '11px', color: 'var(--danger)' }}>
                              {res.message}
                            </div>
                          )}

                          {/* Sample Failure Data */}
                          {res.status === 'FAIL' && res.sample_data && res.sample_data.columns && (
                            <div className="failure-sample">
                              <div className="sample-label">Mismatch Sample (Top 10):</div>
                              <div className="table-container">
                                <table className="sample-table">
                                  <thead>
                                    <tr>
                                      {res.sample_data.columns.map((col, cIdx) => (
                                        <th key={cIdx}>{col}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {res.sample_data.rows.map((row, rIdx) => (
                                      <tr key={rIdx}>
                                        {row.map((val, vIdx) => (
                                          <td key={vIdx}>{val === null ? 'NULL' : String(val)}</td>
                                        ))}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                          <hr className="result-divider" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Contract Management Panel */}
        {showContractPanel && (
          <div className="side-panel wide">
            <div className="panel-header">
              <h3>📄 Contract Management</h3>
              <button onClick={() => setShowContractPanel(false)} className="close-btn">×</button>
            </div>
            <div className="panel-content">
              <div className="contract-actions">
                <button className="create-btn" onClick={openCreateModal}>
                  + New Contract
                </button>
              </div>
              <div className="contract-search">
                <input
                  type="text"
                  className="contract-search-input"
                  placeholder="Search contracts..."
                  value={contractSearchQuery}
                  onChange={(e) => setContractSearchQuery(e.target.value)}
                />
                {contractSearchQuery && (
                  <button
                    className="clear-search-btn"
                    onClick={() => setContractSearchQuery('')}
                  >
                    ×
                  </button>
                )}
              </div>
              <div className="contracts-list">
                {filteredContracts.length === 0 ? (
                  <p className="no-contracts">
                    {contracts.length === 0 ? 'No contracts found' : 'No contracts match your search'}
                  </p>
                ) : (
                  filteredContracts.map((c, i) => (
                    <div key={i} className="contract-item">
                      <div className="contract-info">
                        <span className={`contract-type ${c.type}`}>{c.type}</span>
                        <span className="contract-name">{c.name}</span>
                        <span className="contract-layer">{c.layer}</span>
                        <span className="contract-version">v{c.version}</span>
                      </div>
                      <div className="contract-actions-row">
                        <button className="edit-btn" onClick={() => openEditModal(c)}>Edit</button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="menu-header">
            {contextMenu.node.data.label}
          </div>
          <div className="menu-items">
            {!contextMenu.node.data.expanded && (
              <button onClick={() => { expandNode(contextMenu.node); setContextMenu(null); }}>
                ➡️ Expand / Drill Down
              </button>
            )}
            {contextMenu.node.data.expanded && (
              <button onClick={() => { collapseNode(contextMenu.node); setContextMenu(null); }}>
                ⬅️ Collapse
              </button>
            )}
          </div>
        </div>
      )}

      {/* Contract Modal */}
      {showContractModal && (
        <div className="modal-overlay" onClick={() => setShowContractModal(false)}>
          <div className="modal-container" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingContract ? `Edit ${editingContract.type} Contract` : 'Create New Contract'}</h3>
              <button className="close-btn" onClick={() => setShowContractModal(false)}>×</button>
            </div>
            <div className="modal-body">
              {!editingContract && (
                <div className="form-group">
                  <label>Contract Type</label>
                  <select
                    value={contractForm.type}
                    onChange={(e) => {
                      const newType = e.target.value
                      setContractForm(f => ({
                        ...f,
                        type: newType,
                        content: CONTRACT_TEMPLATES[newType] || ''
                      }))
                    }}
                    className="form-select"
                  >
                    <option value="dataset">Dataset</option>
                    <option value="lineage">Lineage</option>
                    <option value="recon">Reconciliation</option>
                  </select>
                </div>
              )}
              <div className="form-group">
                <label>Contract Content (YAML)</label>
                <div className="codemirror-wrapper">
                  <CodeMirror
                    value={contractForm.content}
                    height="400px"
                    extensions={[loadLanguage('yaml')]}
                    theme={vscodeDark}
                    onChange={(value) => setContractForm(f => ({ ...f, content: value }))}
                    placeholder="Enter contract YAML content..."
                    basicSetup={{
                      lineNumbers: true,
                      highlightActiveLineGutter: true,
                      highlightActiveLine: true,
                      foldGutter: true,
                      indentOnInput: true,
                      bracketMatching: true,
                      autocompletion: false,
                    }}
                  />
                </div>
              </div>

              {/* Validation Errors */}
              {validationErrors.length > 0 && (
                <div className="validation-errors">
                  <div className="validation-header">⚠️ Validation Errors</div>
                  <ul>
                    {validationErrors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Validation Success */}
              {validationSuccess && validationErrors.length === 0 && (
                <div className="validation-success">
                  ✅ Validation passed
                </div>
              )}

              {/* Commit Message */}
              <div className="form-group commit-message-group">
                <label>Commit Message (Required)</label>
                <textarea
                  className="form-textarea"
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  placeholder="Describe your changes..."
                  rows={2}
                />
              </div>

            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowContractModal(false)}>Cancel</button>
              <button className="validate-btn" onClick={validateContract} disabled={contractSaving}>
                Validate
              </button>
              <button className="save-btn" onClick={saveContract} disabled={contractSaving}>
                {contractSaving ? 'Saving...' : 'Submit Change'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function App() {
  return (
    <ReactFlowProvider>
      <LineageContent />
    </ReactFlowProvider>
  )
}

export default App
