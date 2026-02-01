
import React from 'react'
import { X } from 'lucide-react'
import CodeMirror from '@uiw/react-codemirror'
import { loadLanguage } from '@uiw/codemirror-extensions-langs'
import { vscodeDark } from '@uiw/codemirror-theme-vscode'
import { CONTRACT_TEMPLATES } from '../utils/constants'

export const ContractModal = ({
    showContractModal,
    setShowContractModal,
    editingContract,
    contractForm,
    setContractForm,
    validationErrors,
    validationSuccess,
    commitMessage,
    setCommitMessage,
    validateContract,
    contractSaving,
    saveContract
}) => {
    if (!showContractModal) return null

    return (
        <div className="modal-overlay" onClick={() => setShowContractModal(false)}>
            <div className="modal-container" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>{editingContract ? `Edit ${editingContract.type} Contract` : 'Create New Contract'}</h3>
                    <button className="close-btn" onClick={() => setShowContractModal(false)}><X size={18} /></button>
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
    )
}
