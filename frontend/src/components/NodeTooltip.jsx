
import React from 'react'
import { toast } from 'sonner'

export const NodeTooltip = ({ tooltip, setTooltip, tooltipTimeoutRef }) => {
    if (!tooltip.visible || !tooltip.content) return null

    return (
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
                                            <li key={i}>{s.field_name} ({s.dataset})</li>
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
    )
}
