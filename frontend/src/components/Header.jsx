
import React from 'react'
import { Search, Database, Table, Activity, FileCode, Download } from 'lucide-react'

export const Header = ({
    searchRef,
    searchQuery,
    setSearchQuery,
    showSearchDropdown,
    setShowSearchDropdown,
    searchResults,
    handleSearchSelect,
    lineageLevel,
    setLineageLevel,
    selectedDataset,
    setSelectedDataset,
    datasets,
    showReconPanel,
    setShowReconPanel,
    showContractPanel,
    setShowContractPanel,
    setReconTab,
    loadContracts
}) => {
    return (
        <header className="header">
            <h1 onClick={() => window.location.reload()} style={{ cursor: 'pointer' }}>
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="lucide lucide-share2 lucide-share-2 text-primary"
                >
                    <circle cx="18" cy="5" r="3" />
                    <circle cx="6" cy="12" r="3" />
                    <circle cx="18" cy="19" r="3" />
                    <line x1="8.59" x2="15.42" y1="13.51" y2="17.49" />
                    <line x1="15.41" x2="8.59" y1="6.51" y2="10.49" />
                </svg>
                Data Lineage Explorer
            </h1>
            <div className="controls">
                {/* Search Input */}
                <div className="search-container" ref={searchRef}>
                    <div className="search-icon-wrapper">
                        <Search size={14} />
                    </div>
                    <input
                        type="text"
                        className="search-input"
                        placeholder="Search datasets or fields..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onFocus={() => searchQuery.length >= 2 && setShowSearchDropdown(true)}
                        onBlur={() => setTimeout(() => setShowSearchDropdown(false), 200)}
                    />
                    {showSearchDropdown && searchResults.length > 0 && (
                        <div className="search-dropdown">
                            {searchResults.map((result, idx) => (
                                <div
                                    key={result.id || idx}
                                    className="search-result"
                                    onClick={() => handleSearchSelect(result)}
                                    title={result.type === 'field'
                                        ? `Field: ${result.name}\nDataset: ${result.datasetName || result.datasetId}\nID: ${result.id}`
                                        : `Dataset: ${result.name}\nLayer: ${result.layer || 'N/A'}\nDomain: ${result.domain || 'N/A'}\nID: ${result.id}`
                                    }
                                >
                                    <span className={`result-type ${result.type}`}>
                                        {result.type === 'dataset' ? <Database size={14} /> : <Table size={14} />}
                                    </span>
                                    <span className="result-name">{result.name}</span>
                                    {result.type === 'field' && (
                                        <span className="result-dataset" title={result.datasetName}>{result.datasetName}</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Level Toggle */}
                <div className="level-toggle">
                    <button
                        className={`level-btn ${lineageLevel === 'dataset' ? 'active' : ''}`}
                        onClick={() => setLineageLevel('dataset')}
                    >
                        Dataset
                    </button>
                    <button
                        className={`level-btn ${lineageLevel === 'field' ? 'active' : ''}`}
                        onClick={() => setLineageLevel('field')}
                    >
                        Field
                    </button>
                </div>

                {/* Dataset Select */}
                <select
                    value={selectedDataset}
                    onChange={(e) => setSelectedDataset(e.target.value)}
                    className="dataset-select"
                >
                    <option value="">Select a dataset...</option>
                    {datasets.map(d => (
                        <option key={d.id} value={d.id}>{d.name} ({d.layer})</option>
                    ))}
                </select>

                {/* Action Buttons */}
                <button
                    onClick={() => {
                        setShowReconPanel(!showReconPanel);
                        setShowContractPanel(false);
                        if (lineageLevel === 'dataset') setReconTab('dataset');
                    }}
                    className={`action-btn ${showReconPanel ? 'active' : ''}`}
                    disabled={!selectedDataset}
                >
                    <Activity size={14} />
                    Reconcile
                </button>
                <button
                    onClick={() => { setShowContractPanel(!showContractPanel); setShowReconPanel(false); loadContracts() }}
                    className={`action-btn ${showContractPanel ? 'active' : ''}`}
                >
                    <FileCode size={14} />
                    Contracts
                </button>
            </div>
        </header>
    )
}
