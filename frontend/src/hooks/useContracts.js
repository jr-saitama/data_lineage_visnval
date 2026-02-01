
import { useState, useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import yaml from 'js-yaml'
import { API_BASE } from '../utils/api'
import { CONTRACT_TEMPLATES } from '../utils/constants'

export const useContracts = () => {
    const [showContractPanel, setShowContractPanel] = useState(false)
    const [contracts, setContracts] = useState([])

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

    // Load contracts
    const loadContracts = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE}/contracts`)
            const data = await res.json()
            setContracts(data.contracts || [])
        } catch (err) {
            console.error('Failed to load contracts', err)
            toast.error('Failed to load contracts')
        }
    }, [])

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
            // 3. Create Draft
            const draftRes = await fetch(`${API_BASE}/contracts/draft`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contract_type: contractForm.type,
                    content: contractForm.content
                })
            })

            if (!draftRes.ok) {
                throw new Error('Failed to create contract draft')
            }

            const draftData = await draftRes.json()
            const draftId = draftData.draft_id

            // 4. Submit Proposal
            const proposeRes = await fetch(`${API_BASE}/contracts/propose`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    draft_id: draftId,
                    commit_message: commitMessage
                })
            })

            if (!proposeRes.ok) throw new Error('Failed to submit contract proposal')

            toast.success('Contract saved and proposal submitted successfully!')
            setShowContractModal(false)
            loadContracts() // Refresh list
        } catch (err) {
            console.error('Save error:', err)
            toast.error(`Failed to save contract: ${err.message}`)
        } finally {
            setContractSaving(false)
        }
    }, [commitMessage, contractForm, loadContracts, validateContract])

    return {
        showContractPanel,
        setShowContractPanel,
        contracts,
        setContracts,
        showContractModal,
        setShowContractModal,
        editingContract,
        setEditingContract,
        contractForm,
        setContractForm,
        contractSaving,
        contractSearchQuery,
        setContractSearchQuery,
        commitMessage,
        setCommitMessage,
        validationErrors,
        setValidationErrors,
        validationSuccess,
        filteredContracts,
        loadContracts,
        openCreateModal,
        openEditModal,
        validateContract,
        saveContract
    }
}
