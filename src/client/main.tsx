import { createRoot } from 'react-dom/client';
import { BookOpen, Menu } from 'lucide-react';
import { useWorkbench } from './useWorkbench';
import { SourcePanel } from './SourcePanel';
import { ArticleReader } from './ArticleReader';
import { SummaryDialog } from './SummaryDialog';
import './style.css';
import { UpdateNotice } from './UpdateNotice';
import { EvidenceDialog } from './EvidenceDialog';
function App() {
  const model = useWorkbench();
  const { sidebar, setSidebar } = model;
  return (
    <div className="app">
      {' '}
      <header className="topbar">
        <a className="brand" href="/" aria-label="Recast 首页">
          <span className="brand-icon">
            <BookOpen size={21} />
          </span>
          <span>
            Recast<span className="brand-en">VIDEO TO ARTICLE</span>
          </span>
        </a>
        <div className="top-right">
          <span className="top-note">把值得听的，变成值得读的。</span>
          <button
            className="icon-button mobile-menu"
            aria-label={sidebar ? '关闭素材面板' : '打开素材面板'}
            aria-expanded={sidebar}
            onClick={() => setSidebar(!sidebar)}
          >
            <Menu size={20} />
          </button>
          <span className="version">阅读工作台</span>
        </div>
      </header>
      <UpdateNotice busy={model.busy} reload={model.reload} />
      <div className="workspace">
        <SourcePanel model={model} />
        {sidebar && (
          <button
            className="sidebar-scrim"
            aria-label="关闭素材面板"
            onClick={() => setSidebar(false)}
          />
        )}
        <ArticleReader model={model} />
      </div>
      <SummaryDialog model={model} />
      <EvidenceDialog model={model} />
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
