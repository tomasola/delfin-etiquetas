import { useState, useMemo, useEffect } from 'react'
import type { Reference, ToastMessage } from './types'
import { useReferences } from './hooks/useReferences'
import { useDebounce } from './hooks/useDebounce'
import { useTheme } from './hooks/useTheme'
import { LoadingSpinner } from './components/LoadingSpinner'
import { SearchBar } from './components/SearchBar'
import { CategoryFilter } from './components/CategoryFilter'
import { ReferenceCard } from './components/ReferenceCard'
import { ReferenceDetail } from './components/ReferenceDetail'
import { ToastContainer } from './components/Toast'
import { ImageSearchModal } from './components/ImageSearchModal'
import { getUniqueCategories, filterByCategory, filterReferences } from './utils/search'
import { exportDataAsCSV, exportDataAsJSON } from './utils/export'

function App() {
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedRef, setSelectedRef] = useState<Reference | null>(null)
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const [pendingPrint, setPendingPrint] = useState(false)
  const [showImageSearch, setShowImageSearch] = useState(false)
  const [recentRefs, setRecentRefs] = useState<Reference[]>([])
  const [userRefMap, setUserRefMap] = useState<Record<string, { embedding: number[], image: string }>>({})

  // Pagination
  const [page, setPage] = useState(1)
  const ITEMS_PER_PAGE = 24

  const { references, loading, error } = useReferences()
  const { theme, toggleTheme } = useTheme()
  const debouncedSearch = useDebounce(search, 300)

  // Reset page when filter changes
  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, selectedCategory])

  // Get unique categories
  const categories = useMemo(() => getUniqueCategories(references), [references])

  // Filter and search logic
  const filteredResults = useMemo(() => {
    // If no search and no category, return empty
    if (!debouncedSearch.trim() && !selectedCategory) {
      return []
    }

    let result = references

    // 1. Search Logic (Global - searches in all categories)
    if (debouncedSearch.trim()) {
      // Search in all references, ignoring current category filter
      result = filterReferences(references, debouncedSearch)
    }
    // 2. Category Filter (only if no search term)
    else if (selectedCategory) {
      result = filterByCategory(result, selectedCategory)
    }

    // 3. Deduplication (ensure unique codes)
    // "si existe algun duplicado solo se muestra uno"
    const uniqueMap = new Map()
    result.forEach(ref => {
      if (!uniqueMap.has(ref.code)) {
        uniqueMap.set(ref.code, ref)
      }
    })

    return Array.from(uniqueMap.values())
  }, [references, selectedCategory, debouncedSearch])

  // Toast management
  const addToast = (message: string, type: ToastMessage['type'] = 'info') => {
    const toast: ToastMessage = {
      id: Date.now().toString(),
      message,
      type,
      duration: 3000
    }
    setToasts(prev => [...prev, toast])
  }

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  const handleSelectRef = (ref: Reference) => {
    setSelectedRef(ref)
    addToHistory(ref)
  }

  const handleBack = () => {
    setSelectedRef(null)
  }

  const handleSave = (success: boolean) => {
    if (success) {
      addToast('Datos guardados exitosamente', 'success')
    } else {
      addToast('Error al guardar los datos', 'error')
    }
  }

  const handleExportCSV = () => {
    const success = exportDataAsCSV()
    if (success) {
      addToast('Datos exportados a CSV', 'success')
    } else {
      addToast('No hay datos para exportar', 'warning')
    }
  }

  const handleExportJSON = () => {
    const success = exportDataAsJSON()
    if (success) {
      addToast('Datos exportados a JSON', 'success')
    } else {
      addToast('No hay datos para exportar', 'warning')
    }
  }

  const handleSearchChange = (term: string) => {
    setSearch(term)
    if (term) setSelectedCategory('') // Clear category when searching to avoid confusion (Global Search)
  }

  const handleCategorySelect = (category: string) => {
    setSelectedCategory(category)
    setSearch('') // Clear search when selecting a category to show full list
  }

  const handlePrint = (ref: Reference) => {
    if (selectedRef?.code === ref.code) {
      window.print()
    } else {
      setSelectedRef(ref)
      setPendingPrint(true)
    }
  }

  // Handle auto-printing when selectedRef changes due to a print trigger
  useEffect(() => {
    if (selectedRef && pendingPrint) {
      // Need a small timeout to ensure DOM is ready? 
      // Usually React handles this after render, but let's be safe.
      const timer = setTimeout(() => {
        window.print()
        setPendingPrint(false)
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [selectedRef, pendingPrint])

  // Load recent scans from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('recent_scans')
    if (saved) {
      try {
        setRecentRefs(JSON.parse(saved))
      } catch (e) {
        console.error('Error loading history:', e)
      }
    }
  }, [])

  // Save recent scans to localStorage
  useEffect(() => {
    localStorage.setItem('recent_scans', JSON.stringify(recentRefs))
  }, [recentRefs])

  const addToHistory = (ref: Reference) => {
    setRecentRefs(prev => {
      // Remove if already exists to move it to the top
      const filtered = prev.filter(r => r.code !== ref.code)
      return [ref, ...filtered].slice(0, 12) // Keep top 12
    })
  }

  const handleLinkReference = (code: string, capture: { embedding: number[], image: string }) => {
    setUserRefMap(prev => ({
      ...prev,
      [code]: capture
    }))
    addToast('Referencia personalizada vinculada', 'success')
  }

  // Auto-cleanup for old Service Workers (v2 -> v7 transition)
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        // If we see more than one or if it's the first run of v7, we could prune
        // But for now, we just log
        console.log('Active Service Workers:', registrations.length);
      });
    }
  }, []);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ALT + P = Print
      if (e.altKey && e.key.toLowerCase() === 'p') {
        console.log('HID: Alt+P detected via Global Listener');
        e.preventDefault()
        if (selectedRef) {
          console.log('HID: Printing selectedRef:', selectedRef.code);
          window.print()
        } else if (filteredResults.length > 0) {
          console.log('HID: Printing first result:', filteredResults[0].code);
          handlePrint(filteredResults[0])
        } else {
          console.warn('HID: Alt+P received but no reference to print');
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedRef, filteredResults])

  // Show detail view if reference is selected
  if (selectedRef) {
    return (
      <>
        <ReferenceDetail
          reference={selectedRef}
          onBack={handleBack}
          onSave={handleSave}
          userRefMap={userRefMap}
        />
        <ToastContainer messages={toasts} onClose={removeToast} />
      </>
    )
  }

  // Show error state
  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-4 flex items-center justify-center">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 max-w-md">
          <div className="text-red-500 text-5xl mb-4 text-center">⚠️</div>
          <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-2 text-center">Error</h2>
          <p className="text-gray-600 dark:text-gray-400 text-center">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 w-full bg-blue-500 hover:bg-blue-600 text-white py-2 rounded-lg"
          >
            Reintentar
          </button>
        </div>
      </div>
    )
  }

  // Show loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
        <LoadingSpinner />
      </div>
    )
  }

  // Main view
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8 mt-4">
          <img src="/logo.webp" alt="Delfín" className="w-20 h-20 mx-auto mb-4" />
          <h1 className="text-3xl md:text-4xl font-bold text-gray-800 dark:text-white">
            Delfín Etiquetas v20
          </h1>
        </div>

        {/* Theme toggle and export buttons */}
        <div className="flex justify-end gap-2 mb-4">
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg bg-white dark:bg-gray-800 shadow hover:shadow-md transition-shadow"
            aria-label="Cambiar tema"
          >
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
          <button
            onClick={handleExportCSV}
            className="px-4 py-2 rounded-lg bg-white dark:bg-gray-800 shadow hover:shadow-md transition-shadow text-sm"
            aria-label="Exportar a CSV"
          >
            📊 CSV
          </button>
          <button
            onClick={handleExportJSON}
            className="px-4 py-2 rounded-lg bg-white dark:bg-gray-800 shadow hover:shadow-md transition-shadow text-sm"
            aria-label="Exportar a JSON"
          >
            📄 JSON
          </button>
        </div>


        {/* Search bar */}
        <SearchBar
          value={search}
          onChange={handleSearchChange}
          onCameraClick={() => setShowImageSearch(true)}
        />

        <ImageSearchModal
          isOpen={showImageSearch}
          onClose={() => setShowImageSearch(false)}
          onSelectRef={handleSelectRef}
          allReferences={references}
          userRefMap={userRefMap}
          onLinkReference={handleLinkReference}
        />

        {/* Category filter */}
        {categories.length > 0 && (
          <CategoryFilter
            categories={categories}
            selectedCategory={selectedCategory}
            onSelectCategory={handleCategorySelect}
          />
        )}

        {/* Results */}
        {filteredResults.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 md:p-6">
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              {filteredResults.length} resultado{filteredResults.length !== 1 ? 's' : ''}
              {selectedCategory && ` en ${selectedCategory}`}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-4 mb-6">
              {filteredResults.slice(0, page * ITEMS_PER_PAGE).map((ref) => (
                <ReferenceCard
                  key={ref.code}
                  reference={ref}
                  onClick={handleSelectRef}
                  onPrint={() => handlePrint(ref)}
                  userRefMap={userRefMap}
                />
              ))}
            </div>

            {/* Pagination Controls */}
            <div className="flex flex-col sm:flex-row justify-center items-center gap-4 pt-4 pb-8">

              {/* Load More */}
              {filteredResults.length > page * ITEMS_PER_PAGE && (
                <button
                  onClick={() => setPage(p => p + 1)}
                  className="px-8 py-3 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 rounded-full font-bold hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors shadow-sm animate-in fade-in slide-in-from-bottom-4 flex items-center gap-2"
                >
                  <span>👇</span> Cargar más ({filteredResults.length - (page * ITEMS_PER_PAGE)})
                </button>
              )}

              {/* Scroll To Top */}
              {(page > 1 || filteredResults.length > 12) && (
                <button
                  onClick={() => {
                    window.scrollTo({ top: 0, behavior: 'smooth' })
                  }}
                  className="px-6 py-3 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full font-bold hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors shadow-sm animate-in fade-in slide-in-from-bottom-4 flex items-center gap-2"
                >
                  <span>⬆️</span> Inicio
                </button>
              )}
            </div>
          </div>
        )}

        {/* No results */}
        {(search || selectedCategory) && filteredResults.length === 0 && references.length > 0 && (
          <div className="text-center text-gray-600 dark:text-gray-400">
            <p className="text-4xl mb-2">🔍</p>
            <p>No se encontraron resultados</p>
          </div>
        )}

        {/* Empty state */}
        {!search && !selectedCategory && references.length > 0 && (
          <div className="mt-8 animate-in fade-in duration-500">
            {recentRefs.length > 0 ? (
              <div className="bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm rounded-2xl p-6 border border-white/20 shadow-xl">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
                    <span>🕒</span> Escaneos Recientes
                  </h2>
                  <button
                    onClick={() => setRecentRefs([])}
                    className="text-xs text-gray-500 hover:text-red-500 transition-colors uppercase font-bold tracking-widest"
                  >
                    Limpiar
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {recentRefs.map((ref, idx) => (
                    <div
                      key={ref.code}
                      className="animate-cascade-in"
                      style={{ animationDelay: `${idx * 50}ms` }}
                    >
                      <ReferenceCard
                        reference={ref}
                        onClick={handleSelectRef}
                        onPrint={() => handlePrint(ref)}
                        userRefMap={userRefMap}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center text-gray-600 dark:text-gray-400 mt-12">
                <p className="text-4xl mb-2">👆</p>
                <p>Busca una referencia para comenzar</p>
                <p className="text-sm mt-2">{references.length} referencias disponibles</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Toast notifications */}
      <ToastContainer messages={toasts} onClose={removeToast} />
    </div>
  )
}

export default App