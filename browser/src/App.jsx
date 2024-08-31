/* eslint-disable react/prop-types */
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Scrollbars } from 'react-custom-scrollbars'
import folder from './assets/folder.svg'
import folderOpen from './assets/folder-open.svg'
import file from './assets/file.svg'
import fs from './assets/fs.json'

function render(data, indentLevel, isOpen, toggleOpen) {
  let icon = data.children ? (isOpen(data.id) ? folderOpen : folder) : file

  return (
    <div className="flex flex-col">
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
      <AnimatePresence>
        {data.children && isOpen(data.id) && (
          <motion.div
            style={{
              marginLeft: indentLevel + 1 + 'rem'
            }}
            initial={{ height: 0, opacity: 0 }}
            animate={{
              height: 'auto',
              opacity: 1,
              transition: {
                height: {
                  duration: 0.2
                },
                opacity: {
                  duration: 0.125,
                  delay: 0.075
                }
              }
            }}
            exit={{
              height: 0,
              opacity: 0,
              transition: {
                height: {
                  duration: 0.2
                },
                opacity: {
                  duration: 0.125
                }
              }
            }}
          >
            <div>
              {data.children.map((data) =>
                render(data, indentLevel + 1, isOpen, toggleOpen)
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function App() {
  const [openState, setOpenState] = useState({})
  let toggleOpen = (id) => {
    setOpenState((prev) => {
      return { ...prev, [id]: !(prev[id] ? prev[id] : false) }
    })
  }
  let isOpen = (id) => {
    console.log(openState)
    return openState[id] ? openState[id] : false
  }

  return (
    <Scrollbars style={{ width: '100vw', height: '100vh' }}>
      <div className="max-w-screen-md mt-4 mb-4 content-center mx-auto text-center">
        <h1 className="mb-3 text-4xl font-medium">Lilypad</h1>
        <p>Collection of my notes throughout the years</p>
        <div className="text-left mt-2">
          {fs.map((data) => render(data, 0, isOpen, toggleOpen))}
        </div>
      </div>
    </Scrollbars>
  )
}

export default App
