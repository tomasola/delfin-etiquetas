import { useState } from 'react'
import { useLocalStorage } from '../hooks/useLocalStorage'
import type { SearchHistory } from '../types'

interface SearchBarProps {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    onCameraClick: () => void
}

export function SearchBar({ value, onChange, placeholder = 'Buscar referencia...', onCameraClick }: SearchBarProps) {
    const [recentSearches, setRecentSearches] = useLocalStorage<SearchHistory[]>('recent_searches', [])
    const [showSuggestions, setShowSuggestions] = useState(false)

    const addToHistory = (term: string) => {
        if (!term.trim()) return

        const newHistory = [
            { term, timestamp: Date.now() },
            ...recentSearches.filter(s => s.term !== term)
        ].slice(0, 10) // Keep only last 10 searches

        setRecentSearches(newHistory)
    }

    const handleSearch = (term: string) => {
        onChange(term)
        if (term.trim()) {
            addToHistory(term)
        }
    }

    const handleSuggestionClick = (term: string) => {
        onChange(term)
        setShowSuggestions(false)
    }

    const clearHistory = () => {
        setRecentSearches([])
    }

    return (
        <div className="relative mb-8 flex gap-2">
            <div className="relative flex-1">
                <input
                    type="search"
                    value={value}
                    onChange={(e) => handleSearch(e.target.value)}
                    onFocus={() => setShowSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                    placeholder={placeholder}
                    inputMode="search"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck="false"
                    className="w-full px-6 py-4 text-lg rounded-full shadow-lg border-2 border-transparent focus:border-blue-500 focus:outline-none transition-all dark:bg-gray-800 dark:text-white"
                />
                {value && (
                    <button
                        onClick={() => onChange('')}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-2xl"
                        aria-label="Limpiar búsqueda"
                    >
                        ✕
                    </button>
                )}

                {/* Search suggestions */}
                {showSuggestions && !value && recentSearches.length > 0 && (
                    <div className="absolute top-full mt-2 w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden z-10">
                        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700">
                            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Búsquedas recientes</span>
                            <button
                                onClick={clearHistory}
                                className="text-xs text-blue-500 hover:text-blue-600"
                            >
                                Limpiar
                            </button>
                        </div>
                        {recentSearches.map((search, index) => (
                            <button
                                key={index}
                                onClick={() => handleSuggestionClick(search.term)}
                                className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-2"
                            >
                                <span className="text-gray-400">🔍</span>
                                <span className="text-gray-700 dark:text-gray-300">{search.term}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <button
                onClick={onCameraClick}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-full w-16 h-16 flex items-center justify-center shadow-lg transition-colors flex-shrink-0"
                aria-label="Búsqueda visual"
            >
                <span className="text-2xl">📷</span>
            </button>
        </div>
    )
}
