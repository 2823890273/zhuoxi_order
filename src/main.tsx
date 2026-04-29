import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import DashboardV3 from './DashboardV3.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DashboardV3 />
  </StrictMode>,
)
