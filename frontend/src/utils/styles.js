
// Custom node styles with dynamic width support
export const nodeStyles = {
    target_dataset: {
        background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)', // darker indigo/violet
        color: 'white',
        border: 'none',
        borderRadius: '12px 12px 0 0', // Top corners only
        padding: '12px 20px',
        fontWeight: '700',
        fontSize: '14px',
        textAlign: 'center',
        whiteSpace: 'nowrap',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
    },
    source_dataset: {
        background: 'linear-gradient(135deg, #0284c7 0%, #0891b2 100%)', // darker sky/cyan
        color: 'white',
        border: 'none',
        borderRadius: '12px 12px 0 0', // Top corners only
        padding: '12px 20px',
        fontWeight: '600',
        fontSize: '13px',
        textAlign: 'center',
        whiteSpace: 'nowrap',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
    },
    target_field: {
        background: '#1e293b', // Slate 800
        color: '#e2e8f0', // Slate 200
        border: '1px solid #475569', // Slate 600
        borderTop: 'none',
        borderRadius: '0',
        padding: '10px 16px',
        fontWeight: '500',
        fontSize: '12px',
        whiteSpace: 'nowrap',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        height: '40px'
    },
    source_field: {
        background: '#1e293b',
        color: '#e2e8f0',
        border: '1px solid #475569',
        borderTop: 'none',
        borderRadius: '0',
        padding: '10px 16px',
        fontWeight: '500',
        fontSize: '12px',
        whiteSpace: 'nowrap',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        height: '40px'
    },
    // Style for the last field in a group to add bottom rounded corners
    field_last: {
        borderRadius: '0 0 12px 12px',
        borderBottom: '1px solid #475569'
    }
}

// Edge colors by lineage type
export const edgeColors = {
    copied_from: '#10b981',
    calculated_from: '#6366f1',
    derived_from: '#ef4444',
    looked_up_from: '#a855f7',
    depends_on: '#0ea5e9',
}
