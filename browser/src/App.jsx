/* eslint-disable react/prop-types */
import { useRef, useState, useCallback, useEffect } from 'react'
import { Tree } from 'react-arborist'
import folder from './assets/folder.svg'
import file from './assets/file.svg'
import fs from './assets/fs.json'
import './App.css'

function Node({ node, style, dragHandle }) {
  return (
    <div
      className="cursor-pointer hover:bg-gray-100 rounded p-0.5"
      style={style}
      ref={dragHandle}
      onClick={() => {
        if (!node.isLeaf) {
          node.toggle()
        }
      }}
    >
      <img
        src={node.isLeaf ? file : folder}
        alt={node.isLeaf ? 'file' : 'folder'}
        className="w-6 h-6 inline-block mr-1"
      />
      {node.data.name}
    </div>
  )
}

const useResize = (myRef) => {
  const [width, setWidth] = useState(0)
  const [height, setHeight] = useState(0)

  const handleResize = useCallback(() => {
    setWidth(myRef.current.offsetWidth)
    setHeight(myRef.current.offsetHeight)
  }, [myRef])

  useEffect(() => {
    window.addEventListener('load', handleResize)
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('load', handleResize)
      window.removeEventListener('resize', handleResize)
    }
  }, [myRef, handleResize])

  return { width, height }
}

function App() {
  const ref = useRef(null)
  const { width } = useResize(ref)
  return (
    <>
      <div className="max-w-screen-md" ref={ref}>
        <h1 className="mb-3">Lilypad</h1>
        <p>Collection of my notes throughout the years</p>
        <div className="text-left mt-2">
          <Tree
            initialData={fs}
            disableDrag={true}
            disableEdit={true}
            rowHeight={28}
            width={Math.max(width, 768)}
            height={1000}
          >
            {Node}
          </Tree>
        </div>
      </div>
    </>
  )
}

export default App
