
import React from 'react'
import { Maximize2, Minimize2, Zap } from 'lucide-react'

export const NodeContextMenu = ({
    contextMenu,
    setContextMenu,
    expandNode,
    collapseNode,
    handleBlastRadius
}) => {
    if (!contextMenu) return null

    return (
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
                    <>
                        {(['source_dataset', 'source_field'].includes(contextMenu.node.type) ||
                            ['source_dataset', 'source_field'].includes(contextMenu.node.data?.originalType)) && (
                                <button onClick={() => { expandNode(contextMenu.node); setContextMenu(null); }}>
                                    <Maximize2 size={14} /> Expand Dependencies (Upstream)
                                </button>
                            )}

                        {(['target_dataset', 'target_field'].includes(contextMenu.node.type) ||
                            ['target_dataset', 'target_field'].includes(contextMenu.node.data?.originalType)) && (
                                <button onClick={handleBlastRadius}>
                                    <Zap size={14} /> View Blast Radius (Downstream)
                                </button>
                            )}
                    </>
                )}
                {contextMenu.node.data.expanded && (
                    <button onClick={() => { collapseNode(contextMenu.node); setContextMenu(null); }}>
                        <Minimize2 size={14} /> Collapse
                    </button>
                )}
            </div>
        </div>
    )
}
