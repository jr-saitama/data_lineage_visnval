
// Calculate node width based on label length - no max limit for full text
export const calculateNodeWidth = (label) => {
    const baseWidth = 120
    const charWidth = 9 // slightly wider for better readability
    const padding = 50
    return Math.max(baseWidth, label.length * charWidth + padding)
}

// Layout function with dataset-level grouping: sources on left, targets on right
// Creates group boundary boxes around datasets and their fields
export const getLayoutedElements = (nodes, edges) => {
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
        // Use data.dataset if available (more robust), fallback to ID splitting
        const datasetId = field.data?.dataset || field.id.split('.').slice(0, -1).join('.')
        if (!targetFieldsByDataset.has(datasetId)) {
            targetFieldsByDataset.set(datasetId, [])
        }
        targetFieldsByDataset.get(datasetId).push(field)
    })

    // Layout configuration
    const config = {
        startY: 50,
        fieldHeight: 40, // Matches new CSS height
        datasetHeight: 50, // Approximate header height
        groupPadding: 0, // No padding for header look
        groupHeaderHeight: 50,
        groupGap: 30,
        sourceX: 50,
        targetX: 800,
        groupWidth: 280,
        fieldWidth: 280, // Matches group width
    }

    const layoutedNodes = []
    let leftY = config.startY
    let rightY = config.startY

    // Track which source datasets have been processed
    const processedSourceDatasets = new Set()

    // Layout SOURCE side (LEFT) - grouped by dataset with boundary boxes
    sourceFieldsByDataset.forEach((fields, datasetId) => {
        const datasetNode = sourceDatasets.find(d =>
            d.id === datasetId || d.id === `ds-${datasetId}`
        )

        if (datasetNode && !processedSourceDatasets.has(datasetNode.id)) {
            processedSourceDatasets.add(datasetNode.id)
            const groupHeight = config.groupHeaderHeight + (fields.length * config.fieldHeight)
            const groupId = `group-${datasetNode.id}`

            // Create group boundary node
            layoutedNodes.push({
                id: groupId,
                type: 'datasetGroup',
                data: { label: '' },
                position: { x: config.sourceX, y: leftY },
                style: {
                    width: config.groupWidth,
                    height: groupHeight,
                    backgroundColor: 'rgba(14, 165, 233, 0.15)', // transparent sky
                    border: '1px solid #475569',
                    borderRadius: '12px',
                    overflow: 'visible',
                    zIndex: 1
                },
                dragHandle: '.group-drag-handle',
            })

            // Position dataset header inside group
            layoutedNodes.push({
                ...datasetNode,
                parentId: groupId,
                targetPosition: 'left',
                sourcePosition: 'right',
                position: { x: 0, y: 0 },
                style: {
                    ...datasetNode.style,
                    width: config.groupWidth,
                    height: config.groupHeaderHeight,
                    margin: 0,
                    borderRadius: '12px 12px 0 0'
                },
                type: 'default',
                draggable: false
            })

            // Position fields inside group
            fields.forEach((field, index) => {
                const isLast = index === fields.length - 1
                layoutedNodes.push({
                    ...field,
                    parentId: groupId,
                    extent: 'parent',
                    targetPosition: 'left',
                    sourcePosition: 'right',
                    position: {
                        x: 0,
                        y: config.groupHeaderHeight + (index * config.fieldHeight)
                    },
                    style: {
                        ...field.style,
                        width: config.groupWidth,
                        height: config.fieldHeight,
                        borderRadius: '0',
                        ...(isLast ? { borderRadius: '0 0 12px 12px', borderBottom: 'none' } : { borderBottom: '1px solid #475569' })
                    },
                    type: 'default',
                    draggable: false
                })
            })

            leftY += groupHeight + config.groupGap
        }
    })

    // Process remaining source datasets without fields
    sourceDatasets.forEach(dataset => {
        if (!processedSourceDatasets.has(dataset.id)) {
            const groupId = `group-${dataset.id}`
            const groupHeight = config.datasetHeight

            layoutedNodes.push({
                id: groupId,
                type: 'datasetGroup',
                data: { label: '' },
                position: { x: config.sourceX, y: leftY },
                style: {
                    width: config.groupWidth,
                    height: groupHeight,
                    backgroundColor: 'rgba(14, 165, 233, 0.15)',
                    border: '1px solid #475569',
                    borderRadius: '12px',
                    overflow: 'visible',
                    zIndex: 1
                },
                dragHandle: '.group-drag-handle',
            })

            layoutedNodes.push({
                ...dataset,
                parentId: groupId,
                targetPosition: 'left',
                sourcePosition: 'right',
                position: { x: 0, y: 0 },
                style: {
                    ...dataset.style,
                    width: config.groupWidth,
                    height: config.datasetHeight,
                    borderRadius: '12px',
                    margin: 0
                },
                type: 'default',
                draggable: false
            })

            leftY += groupHeight + config.groupGap
        }
    })

    // Layout TARGET side (RIGHT) - grouped by dataset with boundary boxes
    targetDatasets.forEach(dataset => {
        const fields = targetFieldsByDataset.get(dataset.id) || []
        const groupHeight = config.groupHeaderHeight + (fields.length * config.fieldHeight)
        const groupId = `group-${dataset.id}`

        // Create group boundary node
        layoutedNodes.push({
            id: groupId,
            type: 'datasetGroup',
            data: { label: '' },
            position: { x: config.targetX, y: rightY },
            style: {
                width: config.groupWidth,
                height: groupHeight,
                backgroundColor: 'rgba(99, 102, 241, 0.15)', // transparent indigo
                border: '1px solid #475569',
                borderRadius: '12px',
                overflow: 'visible',
                zIndex: 1
            },
            dragHandle: '.group-drag-handle',
        })

        // Position dataset header inside group
        layoutedNodes.push({
            ...dataset,
            parentId: groupId,
            targetPosition: 'left',
            sourcePosition: 'right',
            position: { x: 0, y: 0 },
            style: {
                ...dataset.style,
                width: config.groupWidth,
                height: config.groupHeaderHeight,
                margin: 0,
                ...(fields.length === 0 ? { borderRadius: '12px' } : { borderRadius: '12px 12px 0 0' })
            },
            type: 'default',
            draggable: false
        })

        // Position fields inside group
        fields.forEach((field, index) => {
            const isLast = index === fields.length - 1
            layoutedNodes.push({
                ...field,
                parentId: groupId,
                extent: 'parent',
                targetPosition: 'left',
                sourcePosition: 'right',
                position: {
                    x: 0,
                    y: config.groupHeaderHeight + (index * config.fieldHeight)
                },
                style: {
                    ...field.style,
                    width: config.groupWidth,
                    height: config.fieldHeight,
                    borderRadius: '0',
                    ...(isLast ? { borderRadius: '0 0 12px 12px', borderBottom: 'none' } : { borderBottom: '1px solid #475569' })
                },
                type: 'default',
                draggable: false
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
