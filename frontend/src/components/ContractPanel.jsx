
import React from 'react'
import { X, Plus, Edit2 } from 'lucide-react'

export const ContractPanel = ({
    showContractPanel,
    setShowContractPanel,
    openCreateModal,
    contractSearchQuery,
    setContractSearchQuery,
    filteredContracts,
    contracts,
    openEditModal
}) => {
    if (!showContractPanel) return null

    return (
        <div className="side-panel wide">
            <div className="panel-header">
                <h3>📄 Contract Management</h3>
                <button onClick={() => setShowContractPanel(false)} className="close-btn"><X size={18} /></button>
            </div>
            <div className="panel-content">
                <div className="contract-actions">
                    <button className="create-btn" onClick={openCreateModal}>
                        <Plus size={16} /> New Contract
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
                            <X size={14} />
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
                                    <button className="edit-btn" onClick={() => openEditModal(c)}>
                                        <Edit2 size={14} /> Edit
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    )
}
