import { useCallback, useRef, useState } from 'react'
import { useStore } from '../store'
import { parseGPX } from '../hooks/useGPX'

export default function UploadZone() {
  const {
    setVideoFile, setPoints,
    setExtractionStatus, setExtractionProgress, setExtractionError,
    extractionStatus, extractionProgress, videoFile,
  } = useStore()

  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(async (file: File) => {
    if (!file) return
    setVideoFile(file)
    setExtractionError(null)
    setExtractionStatus('uploading')
    setExtractionProgress(0)

    try {
      const form = new FormData()
      form.append('file', file)

      const res = await fetch('/api/extract/start', { method: 'POST', body: form })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Upload failed' }))
        throw new Error(err.detail ?? 'Upload failed')
      }
      const { job_id } = await res.json()
      setExtractionStatus('extracting')

      // WebSocket — same host, same port, just swap protocol
      const wsProto = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${wsProto}://${location.host}/api/ws/extract/${job_id}`)

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data)
        if (msg.type === 'progress') {
          setExtractionProgress(msg.points)
        } else if (msg.type === 'done') {
          setPoints(parseGPX(msg.gpx))
          setExtractionStatus('done')
          setExtractionProgress(msg.stats.points)
          ws.close()
        } else if (msg.type === 'error') {
          setExtractionError(msg.message)
          setExtractionStatus('error')
          ws.close()
        }
      }
      ws.onerror = () => {
        setExtractionError('Connection error — is the server running?')
        setExtractionStatus('error')
      }
    } catch (err: any) {
      setExtractionError(err.message)
      setExtractionStatus('error')
    }
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const uploading  = extractionStatus === 'uploading'
  const extracting = extractionStatus === 'extracting'
  const done       = extractionStatus === 'done'
  const error      = extractionStatus === 'error'
  const busy       = uploading || extracting

  return (
    <div style={{ padding: '10px', borderBottom: '1px solid var(--b2)', flexShrink: 0 }}>

      {!videoFile ? (
        <div
          onClick={() => fileRef.current?.click()}
          onDrop={onDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          style={{
            border: `2px dashed ${dragOver ? 'var(--acc)' : 'var(--b2)'}`,
            borderRadius: 'var(--r)', padding: '28px 16px', textAlign: 'center',
            cursor: 'pointer', background: dragOver ? 'var(--acc-dim)' : 'var(--s2)',
            transition: 'all .15s',
          }}
        >
          <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.4 }}>🎬</div>
          <div style={{ fontSize: 13, color: 'var(--txt2)', marginBottom: 4 }}>Drop dashcam video here</div>
          <div style={{ fontSize: 11, color: 'var(--txt3)', fontFamily: 'var(--mono)' }}>
            MP4 · MOV · AVI — GPS extracted automatically
          </div>
          <input ref={fileRef} type="file" accept="video/*" style={{ display: 'none' }}
            onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--txt2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              🎬 {videoFile.name}
            </span>
            <button onClick={() => fileRef.current?.click()}
              style={{ fontSize: 10, fontFamily: 'var(--mono)', padding: '3px 8px', background: 'var(--s3)', border: '1px solid var(--b2)', borderRadius: 6, color: 'var(--txt2)', cursor: 'pointer' }}>
              Change
            </button>
            <input ref={fileRef} type="file" accept="video/*" style={{ display: 'none' }}
              onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
          </div>

          {busy && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--txt3)' }}>
                {uploading ? 'Uploading…' : `Extracting GPS… ${extractionProgress} pts`}
              </div>
              <div style={{ height: 3, background: 'var(--s3)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', background: 'linear-gradient(90deg,var(--acc2),var(--acc))',
                  borderRadius: 2, animation: 'dashtrack-progress 1.4s ease infinite',
                }} />
              </div>
            </div>
          )}
          {done  && <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--grn)' }}>✓ GPS extracted — {extractionProgress} points</div>}
          {error && <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--red)', wordBreak: 'break-word' }}>✗ {useStore.getState().extractionError}</div>}
        </div>
      )}

      <style>{`
        @keyframes dashtrack-progress {
          0%   { transform: translateX(-100%); width: 40% }
          50%  { transform: translateX(150%);  width: 60% }
          100% { transform: translateX(300%);  width: 40% }
        }
      `}</style>
    </div>
  )
}
