
import { useState, useCallback, useEffect } from 'react'
import {
    useNodesState,
    useEdgesState,
    useReactFlow,
    addEdge
} from '@xyflow/react'
import { toast } from 'sonner'
import { API_BASE } from '../utils/api'
import { calculateNodeWidth, getLayoutedElements } from '../utils/layoutUtils'
import { nodeStyles, edgeColors } from '../utils/styles'

export const useLineageData = () => {
    const { getNode } = useReactFlow()
    const [nodes, setNodes, onNodesChange] = useNodesState([])
    const [edges, setEdges, onEdgesChange] = useEdgesState([])
    const [datasets, setDatasets] = useState([])
    const [selectedDataset, setSelectedDataset] = useState('')
    const [lineageLevel, setLineageLevel] = useState('field')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [contextMenu, setContextMenu] = useState(null)

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
                labelStyle: { fontSize: 9, fill: '#f8fafc', fontWeight: 600 },
                labelBgStyle: { fill: '#1e293b', fillOpacity: 1, rx: 4, ry: 4 },
                labelBgPadding: [4, 2],
            }))

            // Prepare nodes for layout
            const finalNodes = []

            // Process nodes to group them
            const datasetsMap = new Map() // Map dataset fullName -> fields
            const datasetNodes = []

            uniqueNodes.forEach(n => {
                if (n.type.includes('dataset')) {
                    datasetNodes.push(n)
                } else {
                    const dsName = n.data?.dataset || n.data?.fullName?.split('.').slice(0, -1).join('.')
                    if (!datasetsMap.has(dsName)) datasetsMap.set(dsName, [])
                    datasetsMap.get(dsName).push(n)
                }
            })

            datasetNodes.forEach(dsNode => {
                const isTarget = dsNode.type === 'target_dataset'
                const fields = datasetsMap.get(dsNode.data.fullName) || []
                const groupId = `group-${dsNode.id}`

                const groupHeight = (lineageLevel === 'dataset') ? 50 : 50 + (fields.length * 40)

                // Add Group Node
                finalNodes.push({
                    id: groupId,
                    type: 'datasetGroup',
                    data: { label: '' },
                    position: dsNode.position || { x: 0, y: 0 },
                    style: {
                        width: 280, // standardized
                        height: groupHeight,
                        backgroundColor: isTarget ? 'rgba(99, 102, 241, 0.15)' : 'rgba(14, 165, 233, 0.15)',
                        border: '1px solid #475569',
                        borderRadius: '12px',
                        overflow: 'visible',
                        zIndex: 1,
                        padding: 0
                    },
                    dragHandle: '.group-drag-handle'
                })

                // Add Header Node
                finalNodes.push({
                    ...dsNode,
                    parentId: groupId,
                    position: { x: 0, y: 0 },
                    style: {
                        ...nodeStyles[dsNode.type],
                        width: 280,
                        height: 50,
                        margin: 0,
                        ...(fields.length === 0 ? { borderRadius: '12px' } : { borderRadius: '12px 12px 0 0' })
                    },
                    data: { ...dsNode.data, originalType: dsNode.type },
                    type: 'default',
                    draggable: false
                })

                // Add Field Nodes
                fields.forEach((f, idx) => {
                    const isLast = idx === fields.length - 1
                    finalNodes.push({
                        ...f,
                        parentId: groupId,
                        extent: 'parent',
                        position: { x: 0, y: 50 + (idx * 40) },
                        style: {
                            ...nodeStyles[f.type],
                            width: 280,
                            height: 40,
                            borderRadius: '0',
                            ...(isLast ? { borderRadius: '0 0 12px 12px', borderBottom: 'none' } : { borderBottom: '1px solid #475569' })
                        },
                        data: { ...f.data, originalType: f.type },
                        type: 'default',
                        draggable: false
                    })
                })
            })

            const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
                finalNodes,
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

    // Expand Logic (Drill Down)
    const expandNode = useCallback(async (node) => {
        try {
            const isDataset = node.type === 'source_dataset' || node.data?.originalType === 'source_dataset'
            const endpoint = isDataset ? `/lineage/${node.id}?level=dataset` : `/lineage/field/${node.id}`

            const res = await fetch(`${API_BASE}${endpoint}`)
            if (!res.ok) throw new Error('Failed to fetch dependency lineage')

            const data = await res.json()

            if (data.nodes.length === 0) {
                setNodes(nds => nds.map(n => n.id === node.id ? { ...n, data: { ...n.data, expanded: true } } : n))
                return
            }

            // Helper to calculate absolute position recursively
            const getAbsolutePosition = (n) => {
                let x = n.position.x
                let y = n.position.y
                let currentParentId = n.parentId

                while (currentParentId) {
                    const parent = getNode(currentParentId)
                    if (parent) {
                        x += parent.position.x
                        y += parent.position.y
                        currentParentId = parent.parentId
                    } else {
                        break
                    }
                }
                return { x, y }
            }

            const currentColumn = node.data?.column || -1
            const newColumn = currentColumn - 1

            // Fix: Manually calculate absolute position by traversing parent chain
            const { x: absX, y: absY } = getAbsolutePosition(node)

            // When expanding upstream (source), we move LEFT.
            // When expanding downstream (target), we move RIGHT.
            const isTargetLevel = node.type?.includes('target') || node.data?.originalType?.includes('target')
            const xPos = isTargetLevel ? absX + 600 : absX - 600
            let yPos = absY - 50

            // Process new nodes
            const newNodesByDataset = new Map()
            const newDatasetNodes = []

            data.nodes.forEach(n => {
                if (n.type === 'source_dataset' || n.type === 'target_dataset') {
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
                const groupId = `group-${dsNode.id}`

                // Check if group already exists (including those we just added in this loop)
                const existingGroup = nodes.find(n => n.id === groupId) || nodesToAdd.find(n => n.id === groupId)

                // Default starting Y for fields (Header is at y=0, height 50, so start fields at 50)
                let startY = 50
                let existingChildrenCount = 0
                // removed currentGroupWidth

                if (existingGroup) {
                    const children = nodes.filter(n => n.parentId === groupId && n.type !== 'source_dataset' && n.type !== 'target_dataset' && n.data?.originalType !== 'source_dataset')
                    existingChildrenCount = children.length
                    startY = 50 + (existingChildrenCount * 40)
                    // currentGroupWidth removed as we use 280 standardized

                    // Refresh existing children styles (make them square and restore border)
                    children.forEach(child => {
                        nodesToAdd.push({
                            ...child,
                            style: {
                                ...child.style,
                                borderRadius: '0',
                                borderBottom: '1px solid #475569'
                            }
                        })
                    })
                }

                // Dynamic Width Calculation - Deprecated, using 280
                const totalFieldCount = existingChildrenCount + fields.length
                const groupHeight = (lineageLevel === 'dataset') ? 50 : 50 + (totalFieldCount * 40) // Header 50 + Fields 40 each

                // Collision Detection for New Groups
                let finalY = existingGroup ? existingGroup.position.y : yPos

                if (!existingGroup) {
                    const margin = 30
                    const allNodes = [...nodes, ...nodesToAdd]
                    let colliding = true
                    let attempts = 0
                    while (colliding && attempts < 50) {
                        colliding = false
                        attempts++

                        for (const other of allNodes) {
                            if (other.type === 'datasetGroup' && other.id !== groupId) {
                                if (Math.abs(other.position.x - xPos) < 100) {
                                    const otherY = other.position.y
                                    const otherHeight = parseInt(other.style.height || 0) || 100

                                    if (finalY < otherY + otherHeight + margin && finalY + groupHeight > otherY - margin) {
                                        finalY = otherY + otherHeight + 30
                                        colliding = true
                                        break
                                    }
                                }
                            }
                        }
                    }
                }

                const isTarget = dsNode.type === 'target_dataset' || dsNode.data?.originalType === 'target_dataset'

                const groupNode = {
                    id: groupId,
                    type: 'datasetGroup',
                    data: { label: '' },
                    position: existingGroup ? existingGroup.position : { x: xPos, y: finalY },
                    style: {
                        width: 280, // Hardcoded to match layoutUtils for consistency
                        height: groupHeight,
                        backgroundColor: isTarget ? 'rgba(99, 102, 241, 0.15)' : 'rgba(14, 165, 233, 0.15)', // transparent slate
                        border: isTarget ? '1px solid #475569' : '1px solid #475569',
                        borderRadius: '12px',
                        overflow: 'visible',
                        zIndex: 1,
                        padding: 0
                    },
                    dragHandle: '.group-drag-handle'
                }

                nodesToAdd.push(groupNode)

                // Add Dataset Header if expanding for the first time
                if (!existingGroup) {
                    const dsStyleType = isTarget ? 'target_dataset' : 'source_dataset'
                    nodesToAdd.push({
                        ...dsNode,
                        id: dsNode.id,
                        parentId: groupId,
                        position: { x: 0, y: 0 },
                        targetPosition: 'left',
                        sourcePosition: 'right',
                        style: {
                            ...(nodeStyles[dsNode.type] || nodeStyles[dsStyleType] || nodeStyles['source_dataset']),
                            width: 280,
                            height: 50,
                            margin: 0,
                            ...(fields.length === 0 ? { borderRadius: '12px' } : { borderRadius: '12px 12px 0 0' })
                        },
                        data: { ...dsNode.data, column: newColumn, originalType: dsNode.type || dsStyleType },
                        type: 'default',
                        draggable: false
                    })
                }

                // Add New Fields
                fields.forEach((field, i) => {
                    const fieldStyleType = isTarget ? 'target_field' : 'source_field'
                    const isLast = (i === fields.length - 1)

                    nodesToAdd.push({
                        ...field,
                        parentId: groupId,
                        extent: 'parent',
                        position: { x: 0, y: startY + (i * 40) },
                        targetPosition: 'left',
                        sourcePosition: 'right',
                        style: {
                            ...(nodeStyles[field.type] || nodeStyles[fieldStyleType] || nodeStyles['source_field']),
                            width: 280,
                            height: 40,
                            ...(isLast ? { borderRadius: '0 0 12px 12px', borderBottom: 'none' } : { borderRadius: '0', borderBottom: '1px solid #475569' })
                        },
                        data: { ...field.data, column: newColumn, originalType: field.type || fieldStyleType },
                        type: 'default',
                        draggable: false
                    })
                })

                if (!existingGroup) {
                    yPos = finalY + groupHeight + 30
                }
            })

            setNodes(nds => {
                const updatedOldNodes = nds.map(n => n.id === node.id ? { ...n, data: { ...n.data, expanded: true } } : n)
                const nodesToAddMap = new Map(nodesToAdd.map(n => [n.id, n]))

                const mergedNodes = updatedOldNodes.map(n => {
                    if (nodesToAddMap.has(n.id)) {
                        const newNode = nodesToAddMap.get(n.id)
                        nodesToAddMap.delete(n.id)
                        return newNode
                    }
                    return n
                })

                return [...mergedNodes, ...nodesToAddMap.values()]
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
                    labelStyle: { fontSize: 9, fill: '#f8fafc', fontWeight: 600 },
                    labelBgStyle: { fill: '#1e293b', fillOpacity: 1, rx: 4, ry: 4 },
                    labelBgPadding: [4, 2],
                }))

                const uniqueNewEdges = stylizedNewEdges.filter(e => !existingIds.has(e.id))
                return [...eds, ...uniqueNewEdges]
            })

        } catch (err) {
            console.error(err)
            toast.error('Failed to expand dependencies')
        }
    }, [setNodes, setEdges, getNode, nodes, lineageLevel])

    // Collapse Logic
    const collapseNode = useCallback((node) => {

        // 1. Identify all nodes and edges in the reachable subgraph (upstream or downstream)
        const getAffectedSubgraph = (startNodeId, direction) => {
            const affectedNodes = new Set()
            const affectedEdges = new Set()
            const stack = [startNodeId]

            while (stack.length > 0) {
                const currId = stack.pop()
                const relevantEdges = edges.filter(e => direction === 'down' ? e.source === currId : e.target === currId)

                relevantEdges.forEach(edge => {
                    affectedEdges.add(edge.id)
                    const nextId = direction === 'down' ? edge.target : edge.source
                    if (!affectedNodes.has(nextId)) {
                        affectedNodes.add(nextId)
                        stack.push(nextId)
                    }
                })
            }
            return { affectedNodes, affectedEdges }
        }

        const isTarget = ['target_dataset', 'target_field'].includes(node.type) || ['target_dataset', 'target_field'].includes(node.data?.originalType)
        const { affectedNodes, affectedEdges } = getAffectedSubgraph(node.id, isTarget ? 'down' : 'up')

        // 2. Filter removal: A node can only be removed if ALL its connections in the opposite direction
        // (the "incoming" direction for the subgraph) are also being removed.
        const canRemoveNode = (nodeId, removingNodes, removingEdges) => {
            // Find all edges connected to this node that are NOT in the removal set
            // For downstream removal (isTarget=true), check "incoming" edges (targets the node)
            // For upstream removal (isTarget=false), check "outgoing" edges (sources from the node)
            const vitalEdges = edges.filter(e => {
                const isIncoming = isTarget ? e.target === nodeId : e.source === nodeId
                return isIncoming && !removingEdges.has(e.id)
            })
            return vitalEdges.length === 0
        }

        // We process removal in topological order or layers to ensure we don't orphan nodes
        // Simplified approach: iterative refinement
        let changed = true
        let finalNodesToRemove = new Set(affectedNodes)
        let finalEdgesToRemove = new Set(affectedEdges)

        while (changed) {
            changed = false
            for (const nodeId of finalNodesToRemove) {
                if (!canRemoveNode(nodeId, finalNodesToRemove, finalEdgesToRemove)) {
                    finalNodesToRemove.delete(nodeId)
                    changed = true
                }
            }
        }

        const groupsToRemove = new Set()
        const groupsToCheck = new Set()

        finalNodesToRemove.forEach(id => {
            const n = nodes.find(x => x.id === id)
            if (n?.parentId) groupsToCheck.add(n.parentId)
        })

        groupsToCheck.forEach(groupId => {
            const allCurrentChildren = nodes.filter(n => n.parentId === groupId)
            const remainingChildren = allCurrentChildren.filter(n => !finalNodesToRemove.has(n.id))

            // A group is removed if:
            // 1. It has no children left
            // 2. OR its only remaining child is the header and no other field exists
            const hasRemainingFields = remainingChildren.some(n =>
                n.type.includes('field') || n.data?.originalType?.includes('field')
            )

            if (!hasRemainingFields) {
                groupsToRemove.add(groupId)
                allCurrentChildren.forEach(c => finalNodesToRemove.add(c.id))
            }
        })

        setNodes(nds => {
            const remainingNodes = nds.filter(n => !finalNodesToRemove.has(n.id) && !groupsToRemove.has(n.id))

            // Map to track modified nodes (groups and children positions)
            const modifiedNodes = new Map()

            groupsToCheck.forEach(gid => {
                if (groupsToRemove.has(gid)) return

                const groupNode = remainingNodes.find(n => n.id === gid)
                if (!groupNode) return

                const children = remainingNodes.filter(n => n.parentId === gid)
                // The header node is at y=0. Fields start at y=50.
                const header = children.find(c => c.position.y === 0)
                const fields = children.filter(c => c.position.y >= 50)
                    .sort((a, b) => a.position.y - b.position.y)

                const newGroupHeight = 50 + (fields.length * 40)

                // Update group height
                modifiedNodes.set(gid, {
                    ...groupNode,
                    style: { ...groupNode.style, height: newGroupHeight }
                })

                // Reposition fields to remove gaps
                fields.forEach((f, idx) => {
                    const isLast = idx === fields.length - 1
                    modifiedNodes.set(f.id, {
                        ...f,
                        position: { x: 0, y: 50 + (idx * 40) },
                        style: {
                            ...f.style,
                            ...(isLast ? { borderRadius: '0 0 12px 12px', borderBottom: 'none' } : { borderRadius: '0', borderBottom: '1px solid #475569' })
                        }
                    })
                })

                // Ensure header has correct bottom radius if no fields left
                if (header) {
                    modifiedNodes.set(header.id, {
                        ...header,
                        style: {
                            ...header.style,
                            ...(fields.length === 0 ? { borderRadius: '12px' } : { borderRadius: '12px 12px 0 0' })
                        }
                    })
                }
            })

            return remainingNodes.map(n => {
                const base = modifiedNodes.get(n.id) || n
                if (base.id === node.id) {
                    return { ...base, data: { ...base.data, expanded: false } }
                }
                return base
            })
        })

        setEdges(eds => eds.filter(e => !finalEdgesToRemove.has(e.id)))
    }, [edges, nodes, setNodes, setEdges])

    // Blast Radius Logic (Downstream Expansion)
    const handleBlastRadius = useCallback(async () => {
        if (!contextMenu || !contextMenu.node) return
        const node = contextMenu.node
        setContextMenu(null)

        try {
            const isDataset = node.type.includes('dataset') || node.data?.originalType?.includes('dataset')
            const level = isDataset ? 'dataset' : 'field'

            const res = await fetch(`${API_BASE}/lineage/downstream/${encodeURIComponent(node.id)}?level=${level}`)
            if (!res.ok) throw new Error("Failed to fetch blast radius")

            const data = await res.json()

            if (data.nodes.length === 0) {
                toast.info("No downstream dependencies found")
                return
            }

            const nodesByDataset = new Map()
            const datasetNodes = []
            const datasetIds = new Set()

            data.nodes.forEach(n => {
                if (n.type.includes('dataset')) {
                    if (!datasetIds.has(n.id)) {
                        datasetNodes.push(n)
                        datasetIds.add(n.id)
                    }
                } else {
                    const dsId = n.data?.dataset || n.data?.fullName?.split('.').slice(0, -1).join('.')
                    if (!nodesByDataset.has(dsId)) {
                        nodesByDataset.set(dsId, [])
                    }
                    nodesByDataset.get(dsId).push(n)
                }
            })

            const datasetAdj = new Map()
            const datasetInDegree = new Map()

            datasetIds.forEach(id => {
                datasetAdj.set(id, new Set())
                datasetInDegree.set(id, 0)
            })

            data.edges.forEach(e => {
                let sourceDs = data.nodes.find(n => n.id === e.source)?.data?.dataset || e.source
                let targetDs = data.nodes.find(n => n.id === e.target)?.data?.dataset || e.target

                // Helper to normalize to Dataset ID if present in the current set
                const normalize = (val) => {
                    if (datasetIds.has(val)) return val
                    // Try assuming it's a field ID and get parent
                    if (val && val.includes('.')) {
                        const parent = val.split('.').slice(0, -1).join('.')
                        if (datasetIds.has(parent)) return parent
                    }
                    return null
                }

                const s = normalize(sourceDs)
                const t = normalize(targetDs)

                if (s && t && s !== t) {
                    if (!datasetAdj.has(s)) datasetAdj.set(s, new Set())
                    if (!datasetAdj.get(s).has(t)) {
                        datasetAdj.get(s).add(t)
                        datasetInDegree.set(t, (datasetInDegree.get(t) || 0) + 1)
                    }
                }
            })

            const levelGroups = new Map()
            const queue = []
            datasetInDegree.forEach((degree, id) => {
                if (degree === 0) {
                    queue.push({ id, level: 1 })
                }
            })

            while (queue.length > 0) {
                const { id, level } = queue.shift()
                if (!levelGroups.has(level)) levelGroups.set(level, [])
                const dsNode = datasetNodes.find(n => n.id === id)
                if (dsNode) levelGroups.get(level).push(dsNode)

                const neighbors = datasetAdj.get(id) || new Set()
                neighbors.forEach(neighbor => {
                    datasetInDegree.set(neighbor, datasetInDegree.get(neighbor) - 1)
                    if (datasetInDegree.get(neighbor) === 0) {
                        queue.push({ id: neighbor, level: level + 1 })
                    }
                })
            }

            const getAbsolutePosition = (n) => {
                let x = n.position.x
                let y = n.position.y
                let currentParentId = n.parentId

                while (currentParentId) {
                    const parent = getNode(currentParentId)
                    if (parent) {
                        x += parent.position.x
                        y += parent.position.y
                        currentParentId = parent.parentId
                    } else {
                        break
                    }
                }
                return { x, y }
            }

            const { x: absX, y: absY } = getAbsolutePosition(node)
            const rootWidth = calculateNodeWidth(node.data.label)
            const nodesToAdd = []
            const levelKeys = Array.from(levelGroups.keys()).sort((a, b) => a - b)
            let currentLevelX = absX + rootWidth + 400

            levelKeys.forEach(lvl => {
                const dsList = levelGroups.get(lvl)
                let currentLevelY = absY
                let maxGroupWidth = 0

                dsList.forEach(dsNode => {
                    const dsId = dsNode.id
                    const fields = nodesByDataset.get(dsId) || []
                    const groupId = `group-${dsId}`

                    const existingGroup = nodes.find(n => n.id === groupId) || nodesToAdd.find(n => n.id === groupId)

                    if (existingGroup) {
                        // Identify fields that aren't already in the group
                        const existingChildren = nodes.filter(n => n.parentId === groupId)
                        const existingFieldIds = new Set(existingChildren.map(c => c.id))
                        const newFieldsFromApi = fields.filter(f => !existingFieldIds.has(f.id))

                        if (newFieldsFromApi.length > 0) {
                            const fieldCount = existingChildren.filter(c => c.type.includes('field') || c.data?.originalType?.includes('field')).length
                            const totalFields = fieldCount + newFieldsFromApi.length
                            const newGroupHeight = 50 + (totalFields * 40)

                            // Update existing group height
                            nodesToAdd.push({
                                ...existingGroup,
                                style: { ...existingGroup.style, height: newGroupHeight }
                            })

                            // Add only the missing fields
                            newFieldsFromApi.forEach((field, idx) => {
                                const isLast = idx === newFieldsFromApi.length - 1
                                nodesToAdd.push({
                                    ...field,
                                    parentId: groupId,
                                    extent: 'parent',
                                    position: { x: 0, y: 50 + ((fieldCount + idx) * 40) },
                                    targetPosition: 'left',
                                    sourcePosition: 'right',
                                    style: {
                                        ...nodeStyles['target_field'],
                                        width: 280,
                                        height: 40,
                                        ...(isLast ? { borderRadius: '0 0 12px 12px', borderBottom: 'none' } : { borderBottom: '1px solid #475569' })
                                    },
                                    data: { ...field.data, originalType: 'target_field' },
                                    type: 'default',
                                    draggable: false
                                })
                            })

                            // Update existing children to remove bottom rounding if they were last
                            existingChildren.forEach(child => {
                                if (child.style?.borderRadius?.includes('0 0 12px 12px')) {
                                    nodesToAdd.push({
                                        ...child,
                                        style: { ...child.style, borderRadius: '0', borderBottom: '1px solid #475569' }
                                    })
                                }
                            })
                        }
                        return
                    }

                    const groupHeight = 50 + (fields.length * 40) // Header 50 + Fields 40 each

                    nodesToAdd.push({
                        id: groupId,
                        type: 'datasetGroup',
                        data: { label: '' },
                        position: { x: currentLevelX, y: currentLevelY },
                        style: {
                            width: 280,
                            height: groupHeight,
                            backgroundColor: 'rgba(30, 41, 59, 0.5)', // Slate 800 transparent
                            border: '1px solid #475569', // Slate 600
                            borderRadius: '12px',
                            overflow: 'visible',
                            zIndex: 1,
                            padding: 0
                        },
                        dragHandle: '.group-drag-handle'
                    })

                    nodesToAdd.push({
                        ...dsNode,
                        id: dsId,
                        parentId: groupId,
                        position: { x: 0, y: 0 },
                        targetPosition: 'left',
                        sourcePosition: 'right',
                        style: {
                            ...nodeStyles['target_dataset'],
                            width: 280,
                            height: 50, // Fixed header height
                            margin: 0,
                            ...(fields.length === 0 ? { borderRadius: '12px' } : { borderRadius: '12px 12px 0 0' })
                        },
                        data: { ...dsNode.data, originalType: 'target_dataset' },
                        type: 'default',
                        draggable: false
                    })

                    fields.forEach((field, idx) => {
                        const isLast = idx === fields.length - 1
                        nodesToAdd.push({
                            ...field,
                            parentId: groupId,
                            extent: 'parent',
                            position: { x: 0, y: 50 + (idx * 40) },
                            targetPosition: 'left',
                            sourcePosition: 'right',
                            style: {
                                ...nodeStyles['target_field'],
                                width: 280,
                                height: 40,
                                ...(isLast ? { borderRadius: '0 0 12px 12px', borderBottom: 'none' } : { borderBottom: '1px solid #475569' })
                            },
                            data: { ...field.data, originalType: 'target_field' },
                            type: 'default',
                            draggable: false
                        })
                    })

                    currentLevelY += groupHeight + 40
                })

                currentLevelX += maxGroupWidth + 400
            })

            if (nodesToAdd.length > 0) {
                setNodes(curr => {
                    const nodeMap = new Map(curr.map(n => [n.id, n]))
                    nodesToAdd.forEach(n => {
                        nodeMap.set(n.id, n)
                    })
                    return Array.from(nodeMap.values())
                })

                const newEdges = data.edges.map(e => ({
                    ...e,
                    id: `e-${e.source}-${e.target}`,
                    type: 'default',
                    animated: true,
                    style: {
                        stroke: edgeColors[e.type] || '#6366f1',
                        strokeWidth: 2
                    },
                    label: e.label || e.type?.replace(/_/g, ' ').toUpperCase(),
                    labelStyle: { fontSize: 9, fill: '#f8fafc', fontWeight: 600 },
                    labelBgStyle: { fill: '#1e293b', fillOpacity: 1, rx: 4, ry: 4 },
                    labelBgPadding: [4, 2],
                }))

                setEdges(curr => {
                    const existingIds = new Set(curr.map(e => e.id))
                    const uniqueNewEdges = newEdges.filter(e => !existingIds.has(e.id))
                    return [...curr, ...uniqueNewEdges]
                })

                toast.success(`Found ${nodesToAdd.length} downstream nodes`)
            } else {
                toast.info("Downstream dependencies already visible")
            }

            setNodes(nds => nds.map(n => {
                if (n.id === node.id) {
                    return { ...n, data: { ...n.data, expanded: true } }
                }
                return n
            }))

        } catch (e) {
            console.error(e)
            toast.error("Failed to load blast radius")
        }
    }, [contextMenu, nodes, setNodes, setEdges, getNode])

    const onConnect = useCallback(
        (params) => setEdges((eds) => addEdge(params, eds)),
        [setEdges],
    )

    // Auto-load when dataset or level changes
    useEffect(() => {
        if (selectedDataset) {
            loadLineage()
        }
    }, [selectedDataset, lineageLevel, loadLineage])

    return {
        nodes,
        onNodesChange,
        setNodes,
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
        loadLineage,
        expandNode,
        collapseNode,
        handleBlastRadius,
        onConnect
    }
}
