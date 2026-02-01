
import { useState, useRef, useEffect, useCallback } from 'react'
import { API_BASE } from '../utils/api'

export const useSearch = () => {
    const [searchQuery, setSearchQuery] = useState('')
    const [searchResults, setSearchResults] = useState([])
    const [showSearchDropdown, setShowSearchDropdown] = useState(false)
    const searchRef = useRef(null)

    const handleSearchChange = (query) => {
        setSearchQuery(query)
        if (query.length < 2) {
            setSearchResults([])
        }
    }

    // Search functionality with debounce
    useEffect(() => {
        if (searchQuery.length < 2) {
            return
        }

        const timer = setTimeout(() => {
            fetch(`${API_BASE}/search?q=${encodeURIComponent(searchQuery)}`)
                .then(res => res.json())
                .then(data => {
                    // Deduplicate search results by unique ID
                    const seen = new Set()
                    const uniqueResults = (data.results || []).filter(result => {
                        const key = result.id
                        if (seen.has(key)) return false
                        seen.add(key)
                        return true
                    })
                    setSearchResults(uniqueResults)
                    setShowSearchDropdown(true)
                })
                .catch(() => setSearchResults([]))
        }, 300)

        return () => clearTimeout(timer)
    }, [searchQuery])

    const resetSearch = useCallback(() => {
        setSearchQuery('')
        setSearchResults([])
        setShowSearchDropdown(false)
    }, [])

    return {
        searchQuery,
        setSearchQuery: handleSearchChange,
        searchResults,
        showSearchDropdown,
        setShowSearchDropdown,
        searchRef,
        resetSearch
    }
}
