import React, { useRef, useEffect } from 'react';
import type { LogEntry } from '../types';

interface LogPanelProps {
  logs: LogEntry[];
  onClear: () => void;
}

const LogPanel: React.FC<LogPanelProps> = ({ logs, onClear }) => {
  const logEndRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);
  
  const getLevelIcon = (level: string) => {
    switch (level) {
      case 'error': return '🔴';
      case 'warning': return '🟡';
      case 'success': return '🟢';
      default: return '🔵';
    }
  };
  
  const getLevelClass = (level: string) => {
    switch (level) {
      case 'error': return 'log-error';
      case 'warning': return 'log-warning';
      case 'success': return 'log-success';
      default: return 'log-info';
    }
  };
  
  return (
    <div className="log-panel">
      <div className="log-header">
        <h4>📋 Console Logs</h4>
        <button onClick={onClear} className="log-clear">Clear</button>
      </div>
      <div className="log-content">
        {logs.length === 0 && (
          <div className="log-empty">No logs yet. Connect to start...</div>
        )}
        {logs.map(log => (
          <div key={log.id} className={`log-entry ${getLevelClass(log.level)}`}>
            <span className="log-time">{log.timestamp.toLocaleTimeString()}</span>
            <span className="log-icon">{getLevelIcon(log.level)}</span>
            <span className="log-source">[{log.source}]</span>
            <span className="log-message">{log.message}</span>
          </div>
        ))}
        <div ref={logEndRef} />
      </div>
    </div>
  );
};

export default LogPanel;