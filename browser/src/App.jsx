/* eslint-disable react/prop-types */
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Scrollbars } from 'react-custom-scrollbars'
import folder from './assets/folder.svg'
import folderOpen from './assets/folder-open.svg'
import file from './assets/file.svg'
import fs from './assets/fs.json'

function render(data, indentLevel, isOpen, toggleOpen) {
  let icon = data.children ? (isOpen(data.id) ? folderOpen : folder) : file
  return (
    <div className="flex flex-col" key={data.id}>
      <a
        className="flex flex-row hover:bg-gray-200 p-0.5 rounded-md text-md text-black hover:text-black"
        onClick={(event) => {
          if (data.children) {
            event.preventDefault()
            toggleOpen(data.id)
          }
        }}
        href={data.id.replace('.md', '.html')}
      >
        <img src={icon} className="mr-2" />
        <p className={data.children ? 'font-medium' : 'font-normal'}>
          {(data.order ? data.order + '. ' : '') + data.name}
        </p>
      </a>
      {data.children && (
        <AnimatePresence initial={false}>
          {isOpen(data.id) && (
            <motion.div
              style={{
                marginLeft: indentLevel + 1 + 'rem',
                overflow: 'hidden'
              }}
              initial={{ height: 0, opacity: 0 }}
              animate={{
                height: 'auto',
                opacity: 1,
                transition: {
                  height: {
                    duration: 0.3
                  },
                  opacity: {
                    duration: 0.2,
                    delay: 0.1
                  }
                }
              }}
              exit={{
                height: 0,
                opacity: 0,
                transition: {
                  height: {
                    duration: 0.3
                  },
                  opacity: {
                    duration: 0.2
                  }
                }
              }}
            >
              <div className="flex flex-col">
                {data.children.map((childData) =>
                  render(childData, indentLevel + 1, isOpen, toggleOpen)
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  )
}

function App() {
  const [openState, setOpenState] = useState({})

  // Sync openState with URL on mount and state changes
  useEffect(() => {
    // Load initial state from URL
    const loadStateFromURL = () => {
      try {
        const params = new URLSearchParams(window.location.search)
        const openStateParam = params.get('open')
        if (openStateParam) {
          const decodedState = JSON.parse(decodeURIComponent(openStateParam))
          setOpenState(decodedState)
        }
      } catch (e) {
        console.error('Error parsing URL state:', e)
      }
    }

    loadStateFromURL()

    // Listen for popstate events (back/forward navigation)
    const handlePopState = () => {
      loadStateFromURL()
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  // Update URL when openState changes
  useEffect(() => {
    if (Object.keys(openState).length === 0) return

    const stateParam = encodeURIComponent(JSON.stringify(openState))
    const url = new URL(window.location)
    url.searchParams.set('open', stateParam)

    // Update URL without reloading the page
    window.history.pushState({}, '', url)
  }, [openState])

  let toggleOpen = (id) => {
    setOpenState((prev) => {
      const newState = { ...prev }
      newState[id] = !prev[id]

      // If we're closing a folder, also close all its children
      if (!newState[id] && fs) {
        const closeChildren = (items) => {
          for (const item of items) {
            if (item.id.startsWith(id + '/') && item.children) {
              newState[item.id] = false
              if (item.children) {
                closeChildren(item.children)
              }
            }
          }
        }

        const findAndCloseChildren = (items) => {
          for (const item of items) {
            if (item.id === id && item.children) {
              closeChildren(item.children)
              break
            } else if (item.children) {
              findAndCloseChildren(item.children)
            }
          }
        }

        findAndCloseChildren(fs)
      }

      return newState
    })
  }

  let isOpen = (id) => {
    return !!openState[id]
  }

  return (
    <Scrollbars style={{ width: '100vw', height: '100vh' }}>
      <div className="content-center max-w-screen-md mx-auto mt-4 mb-4 text-center">
        <h1 className="mb-3 text-4xl font-medium">Lilypad</h1>
        <p>Collection of my notes throughout the years</p>
        <div className="mt-2 text-left">
          {fs.map((data) => render(data, 0, isOpen, toggleOpen))}
        </div>
      </div>
    </Scrollbars>
  )
}

export default App
