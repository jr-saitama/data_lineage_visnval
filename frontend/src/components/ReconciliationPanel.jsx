
import React from 'react'
import { X } from 'lucide-react'

export const ReconciliationPanel = ({
    showReconPanel,
    setShowReconPanel,
    selectedDataset,
    lineageLevel,
    reconTab,
    setReconTab,
    setReconResults,
    reconSearchQuery,
    setReconSearchQuery,
    selectAllFields,
    selectedFields,
    currentTargetFields,
    toggleField,
    selectAllRecon,
    selectedReconChecks,
    toggleReconCheck,
    filteredReconChecks,
    availableReconChecks,
    activeParameters,
    executionParams,
    setExecutionParams,
    runReconciliation,
    loading,
    reconResults
}) => {
    if (!showReconPanel || !selectedDataset) return null

    return (
        <div className="side-panel wide">
            <div className="panel-header">
                <h3>⚡ Reconciliation</h3>
                <button onClick={() => setShowReconPanel(false)} className="close-btn"><X size={18} /></button>
            </div>
            <div className="panel-content">
                <div className="panel-info">
                    Verify data integrity for <strong>{selectedDataset}</strong>.
                </div>

                {/* Tabs */}
                <div className="tab-group">
                    {lineageLevel !== 'dataset' && (
                        <button
                            className={`tab-btn ${reconTab === 'lineage' ? 'active' : ''}`}
                            onClick={() => { setReconTab('lineage'); setReconResults(null); }}
                        >
                            Field Lineage (Reverse Match)
                        </button>
                    )}
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
                            <X size={14} />
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
    )
}
