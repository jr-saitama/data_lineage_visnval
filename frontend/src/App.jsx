import { useState, useEffect, useCallback, useRef } from 'react'
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  ReactFlowProvider,
  Panel,
  useReactFlow,
  ControlButton,
} from '@xyflow/react'
import { Toaster } from 'sonner'
import { toPng } from 'html-to-image'

import '@xyflow/react/dist/style.css'
import './App.css'

// Using custom layout algorithm instead of dagre

import { API_BASE } from './utils/api'
import { Download, Activity, Table } from 'lucide-react'
import { Header } from './components/Header'
import { NodeContextMenu } from './components/NodeContextMenu'
import { ReconciliationPanel } from './components/ReconciliationPanel'
import { ContractPanel } from './components/ContractPanel'
import { ContractModal } from './components/ContractModal'
import { NodeTooltip } from './components/NodeTooltip'
import { useSearch } from './hooks/useSearch'
import { useContracts } from './hooks/useContracts'
import { useLineageData } from './hooks/useLineageData'
import { useReconciliation } from './hooks/useReconciliation'






// Custom node components
const GroupNode = () => {
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'visible' }}>
      <div className="group-drag-handle" title="Drag to move dataset" />
    </div>
  );
};

const nodeTypes = {
  datasetGroup: GroupNode,
};


function LineageContent() {
  const { fitView } = useReactFlow()
  const {
    nodes,
    onNodesChange,
    edges,
    onEdgesChange,
    setEdges,
    datasets,
    setDatasets,
    selectedDataset,
    setSelectedDataset,
    lineageLevel,
    setLineageLevel,
    loading,
    error,
    contextMenu,
    setContextMenu,
    expandNode,
    collapseNode,
    handleBlastRadius,
    onConnect
  } = useLineageData()

  // Tooltip delay ref

  // Search state
  const {
    searchQuery,
    setSearchQuery,
    searchResults,
    showSearchDropdown,
    setShowSearchDropdown,
    searchRef,
    resetSearch
  } = useSearch()

  const tooltipTimeoutRef = useRef(null)

  // Tooltip state
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, content: null })

  // Panel states
  const flowContainerRef = useRef(null)

  // Panel states
  const [showReconPanel, setShowReconPanel] = useState(false)
  const [showDownloadDropdown, setShowDownloadDropdown] = useState(false)

  const [selectedNode, setSelectedNode] = useState(null)

  // Export handlers
  const handleExportPNG = useCallback(() => {
    if (!flowContainerRef.current) return

    // Standardize viewport for capture
    fitView({ padding: 0.1, duration: 0 })

    // Minimal delay to ensure React Flow has applied the new viewport state
    setTimeout(() => {
      const viewport = flowContainerRef.current.querySelector('.react-flow__viewport') ||
        flowContainerRef.current.querySelector('.react-flow__renderer') ||
        flowContainerRef.current

      toPng(viewport, {
        backgroundColor: '#0f172a',
        filter: (node) => {
          const exclusionClasses = [
            'react-flow__controls',
            'react-flow__minimap',
            'react-flow__panel',
            'react-flow__attribution',
            'download-dropdown',
            'legend'
          ]
          if (node.className && typeof node.className === 'string') {
            return !exclusionClasses.some(cls => node.className.includes(cls))
          }
          return true
        }
      })
        .then((dataUrl) => {
          const link = document.createElement('a')
          link.download = `lineage-${selectedDataset || 'export'}.png`
          link.href = dataUrl
          link.click()
        })
        .catch((err) => {
          console.error('Failed to export PNG:', err)
        })
    }, 100)
  }, [selectedDataset, fitView])

  const handleExportCSV = useCallback(() => {
    // Columns: ID, Name, Type, Parent, Lineage Type, Sources, Description, Validation Query
    const headers = ['ID', 'Name', 'Type', 'Parent', 'Lineage Type', 'Sources', 'Description', 'Validation Query']

    // Process nodes to extract details
    const csvRows = nodes.map(node => {
      const id = node.id
      const name = node.data?.label || ''
      const type = node.data?.originalType || node.type
      const parent = node.parentId || ''

      // Get lineage info from node data
      const lineageType = node.data?.lineageType || ''
      const sources = (node.data?.sources || []).map(s => s.field_id || s.id).join('; ')
      const description = (node.data?.description || '').replace(/"/g, '""')
      const validationQuery = (node.data?.validationQuery || '').replace(/"/g, '""')

      return [
        `"${id}"`,
        `"${name}"`,
        `"${type}"`,
        `"${parent}"`,
        `"${lineageType}"`,
        `"${sources}"`,
        `"${description}"`,
        `"${validationQuery}"`
      ].join(',')
    })

    const csvContent = [headers.join(','), ...csvRows].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)

    link.setAttribute('href', url)
    link.setAttribute('download', `lineage-${selectedDataset || 'export'}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }, [nodes, selectedDataset])

  const {
    showContractPanel,
    setShowContractPanel,
    contracts,
    setContracts,
    showContractModal,
    setShowContractModal,
    editingContract,
    contractForm,
    setContractForm,
    contractSaving,
    contractSearchQuery,
    setContractSearchQuery,
    commitMessage,
    setCommitMessage,
    validationErrors,
    validationSuccess,
    filteredContracts,
    loadContracts,
    openCreateModal,
    openEditModal,
    validateContract,
    saveContract
  } = useContracts()


  // Reconciliation Logic
  const {
    reconTab,
    setReconTab,
    availableReconChecks,
    selectedReconChecks,
    selectedFields,
    reconSearchQuery,
    setReconSearchQuery,
    executionParams,
    setExecutionParams,
    reconResults,
    setReconResults,
    reconLoading,
    runReconciliation,
    toggleField,
    toggleReconCheck,
    selectAllFields,
    selectAllRecon,
    filteredTargetFields,
    filteredReconChecks,
    activeParameters
  } = useReconciliation(selectedDataset, nodes)

  // Custom onNodesChange to block dataset node dragging (lock child in place)
  const handleNodesChange = useCallback((changes) => {
    const filteredChanges = changes.filter(change => {
      if (change.type === 'position' && change.dragging) {
        const node = nodes.find(n => n.id === change.id)
        const isDataset = node && (node.type.includes('dataset') || node.data?.originalType?.includes('dataset'))
        if (isDataset && node.parentId) return false
      }
      return true
    })
    onNodesChange(filteredChanges)
  }, [nodes, onNodesChange])

  // Auto-switch recon tab if switching to dataset level
  useEffect(() => {
    if (lineageLevel === 'dataset') {
      setReconTab('dataset')
    }
  }, [lineageLevel, setReconTab])

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
  }, [activeParameters, setExecutionParams])


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
        // setError(`Failed to load data: ${err.message}`) // This is handled by useLineageData
      })
  }, [setContracts, setDatasets])



  // Updated Node Click Handler -> Selection Only
  const onNodeClick = useCallback((event, node) => {
    // 1. Selection
    setSelectedNode((prev) => (prev === node.id ? null : node.id))
  }, [])

  // Node Context Menu Logic (Right Click)
  const onNodeContextMenu = useCallback((event, node) => {
    // Enable for Source, Target, and previously expanded nodes
    const validTypes = ['source_field', 'source_dataset', 'target_dataset', 'target_field']
    const isSource = validTypes.includes(node.type) ||
      validTypes.includes(node.data?.originalType)

    if (isSource) {
      event.preventDefault()

      // Use mouse event coordinates for reliable positioning
      // This works perfectly with position: fixed CSS
      setContextMenu({
        visible: true,
        x: event.clientX,
        y: event.clientY,
        node: node
      })
    }
  }, [setContextMenu])

  // Close menu on click elsewhere
  const onPaneClick = useCallback(() => {
    setContextMenu(null)
  }, [setContextMenu])



  // Handle search result selection
  const handleSearchSelect = (result) => {
    if (result.type === 'dataset') {
      setSelectedDataset(result.id)
    } else if (result.type === 'field') {
      setSelectedDataset(result.datasetId)
    }
    resetSearch()
  }

  // Node hover handlers
  const onNodeMouseEnter = useCallback((event, node) => {
    // Clear any pending hide timer
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current)
      tooltipTimeoutRef.current = null
    }
    // Ignore group nodes
    if (node.type === 'group' || node.type === 'datasetGroup') return

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






  return (
    <div className="app">
      <Toaster richColors position="top-right" />
      <Header
        searchRef={searchRef}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        showSearchDropdown={showSearchDropdown}
        setShowSearchDropdown={setShowSearchDropdown}
        searchResults={searchResults}
        handleSearchSelect={handleSearchSelect}
        lineageLevel={lineageLevel}
        setLineageLevel={setLineageLevel}
        selectedDataset={selectedDataset}
        setSelectedDataset={setSelectedDataset}
        datasets={datasets}
        showReconPanel={showReconPanel}
        setShowReconPanel={setShowReconPanel}
        showContractPanel={showContractPanel}
        setShowContractPanel={setShowContractPanel}
        setReconTab={setReconTab}
        loadContracts={loadContracts}
      />

      {error && <div className="error">{error}</div>}
      {loading && <div className="loading">Loading lineage...</div>}
      <div className="main-content">
        <div className="flow-container" ref={flowContainerRef}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            onNodeMouseEnter={onNodeMouseEnter}
            onNodeMouseLeave={onNodeMouseLeave}
            onNodeClick={onNodeClick}
            onNodeContextMenu={onNodeContextMenu}
            onPaneClick={onPaneClick}
            fitView
            fitViewOptions={{ padding: 0.2 }}
          >
            <Controls position="bottom-left" style={{ display: 'flex', flexDirection: 'column' }}>
              <ControlButton
                onClick={() => {
                  console.log('Export button clicked');
                  setShowDownloadDropdown(prev => !prev);
                }}
                title="Export Lineage"
              >
                <Download size={14} />
              </ControlButton>
            </Controls>

            {showDownloadDropdown && (
              <Panel position="bottom-left" style={{ marginLeft: '45px', marginBottom: '10px' }}>
                <div style={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)',
                  zIndex: 1000,
                  minWidth: '160px',
                  overflow: 'hidden'
                }} className="download-dropdown">
                  <button
                    onClick={() => { handleExportPNG(); setShowDownloadDropdown(false); }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      width: '100%',
                      padding: '10px 12px',
                      border: 'none',
                      background: 'none',
                      color: '#f1f5f9',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontSize: '12px'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#334155'}
                    onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <Activity size={12} /> PNG Image
                  </button>
                  <button
                    onClick={() => { handleExportCSV(); setShowDownloadDropdown(false); }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      width: '100%',
                      padding: '10px 12px',
                      border: 'none',
                      background: 'none',
                      color: '#f1f5f9',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontSize: '12px',
                      borderTop: '1px solid #334155'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#334155'}
                    onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <Table size={12} /> Metadata (CSV)
                  </button>
                </div>
              </Panel>
            )}
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
        <NodeTooltip
          tooltip={tooltip}
          setTooltip={setTooltip}
          tooltipTimeoutRef={tooltipTimeoutRef}
        />

        {/* Reconciliation Panel */}
        <ReconciliationPanel
          showReconPanel={showReconPanel}
          setShowReconPanel={setShowReconPanel}
          selectedDataset={selectedDataset}
          reconTab={reconTab}
          setReconTab={setReconTab}
          lineageLevel={lineageLevel}
          reconSearchQuery={reconSearchQuery}
          setReconSearchQuery={setReconSearchQuery}
          selectedFields={selectedFields}
          currentTargetFields={filteredTargetFields}
          toggleField={toggleField}
          selectAllFields={selectAllFields}
          selectedReconChecks={selectedReconChecks}
          filteredReconChecks={filteredReconChecks}
          toggleReconCheck={toggleReconCheck}
          selectAllRecon={selectAllRecon}
          availableReconChecks={availableReconChecks}
          activeParameters={activeParameters}
          reconResults={reconResults}
          setReconResults={setReconResults}
          runReconciliation={runReconciliation}
          loading={reconLoading}
          executionParams={executionParams}
          setExecutionParams={setExecutionParams}
        />

        {/* Contract Management Panel */}
        <ContractPanel
          showContractPanel={showContractPanel}
          setShowContractPanel={setShowContractPanel}
          openCreateModal={openCreateModal}
          contractSearchQuery={contractSearchQuery}
          setContractSearchQuery={setContractSearchQuery}
          filteredContracts={filteredContracts}
          contracts={contracts}
          openEditModal={openEditModal}
        />
      </div >

      {/* Context Menu */}
      < NodeContextMenu
        contextMenu={contextMenu}
        setContextMenu={setContextMenu}
        expandNode={expandNode}
        collapseNode={collapseNode}
        handleBlastRadius={handleBlastRadius}
      />

      {/* Contract Modal */}
      < ContractModal
        showContractModal={showContractModal}
        setShowContractModal={setShowContractModal}
        editingContract={editingContract}
        contractForm={contractForm}
        setContractForm={setContractForm}
        validationErrors={validationErrors}
        validationSuccess={validationSuccess}
        commitMessage={commitMessage}
        setCommitMessage={setCommitMessage}
        validateContract={validateContract}
        contractSaving={contractSaving}
        saveContract={saveContract}
      />
    </div >
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
