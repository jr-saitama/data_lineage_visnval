
import { useState, useCallback, useMemo, useEffect } from 'react'
import { API_BASE } from '../utils/api'

export const useReconciliation = (selectedDataset, nodes) => {
    const [reconTab, setReconTab] = useState('lineage') // 'lineage' or 'dataset'
    const [availableReconChecks, setAvailableReconChecks] = useState([])
    const [selectedReconChecks, setSelectedReconChecks] = useState(new Set())
    const [selectedFields, setSelectedFields] = useState(new Set())
    const [reconSearchQuery, setReconSearchQuery] = useState('')
    const [executionParams, setExecutionParams] = useState({})
    const [reconResults, setReconResults] = useState(null)
    const [loading, setLoading] = useState(false)

    // Get target fields for current dataset
    const currentTargetFields = useMemo(() => {
        if (!selectedDataset) return []
        // Find fields where ID starts with selectedDataset and type is target_field
        return nodes.filter(n =>
            (n.data?.originalType === 'target_field' || n.type === 'target_field') &&
            n.id.startsWith(`${selectedDataset}.`) &&
            n.data?.hasValidation // Only show fields with validation logic
        ).map(n => ({
            name: n.data.label,
            id: n.id,
            parameters: n.data?.parameters || []
        }))
    }, [selectedDataset, nodes])

    // Filter available checks based on search
    const filteredReconChecks = useMemo(() => {
        if (!reconSearchQuery) return availableReconChecks
        return availableReconChecks.filter(c =>
            c.name.toLowerCase().includes(reconSearchQuery.toLowerCase()) ||
            c.description?.toLowerCase().includes(reconSearchQuery.toLowerCase())
        )
    }, [availableReconChecks, reconSearchQuery])

    // Filter target fields based on search
    const filteredTargetFields = useMemo(() => {
        if (!reconSearchQuery) return currentTargetFields
        return currentTargetFields.filter(f =>
            f.name.toLowerCase().includes(reconSearchQuery.toLowerCase())
        )
    }, [currentTargetFields, reconSearchQuery])

    // Fetch available recon checks when tab changes to dataset
    useEffect(() => {
        setAvailableReconChecks([])
        if (reconTab === 'dataset' && selectedDataset) {
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
                        } else {
                            setAvailableReconChecks([])
                        }
                    })
                    .catch((err) => {
                        console.error('Failed to fetch recon contract:', err)
                        setAvailableReconChecks([])
                    })
            }
        }
    }, [reconTab, selectedDataset])

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
        // If we have a filtered list (search active), operate on that
        const targetList = reconSearchQuery ? filteredTargetFields : currentTargetFields

        // Check if all *currently visible* fields are selected
        const allVisibleSelected = targetList.every(f => selectedFields.has(f.name))

        if (allVisibleSelected) {
            // Deselect visible fields
            const next = new Set(selectedFields)
            targetList.forEach(f => next.delete(f.name))
            setSelectedFields(next)
        } else {
            // Select all visible fields
            const next = new Set(selectedFields)
            targetList.forEach(f => next.add(f.name))
            setSelectedFields(next)
        }
    }

    const selectAllRecon = () => {
        const targetList = reconSearchQuery ? filteredReconChecks : availableReconChecks
        const allVisibleSelected = targetList.every(c => selectedReconChecks.has(c.name))

        if (allVisibleSelected) {
            const next = new Set(selectedReconChecks)
            targetList.forEach(c => next.delete(c.name))
            setSelectedReconChecks(next)
        } else {
            const next = new Set(selectedReconChecks)
            targetList.forEach(c => next.add(c.name))
            setSelectedReconChecks(next)
        }
    }

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


    return {
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
        reconLoading: loading,
        runReconciliation,
        toggleField,
        toggleReconCheck,
        selectAllFields,
        selectAllRecon,
        currentTargetFields,
        filteredTargetFields,
        filteredReconChecks,
        activeParameters
    }
}
