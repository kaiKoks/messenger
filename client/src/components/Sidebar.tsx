import React from 'react';

interface SidebarProps {
  currentUser: string | null;
  onlineUsers: string[];
  selectedUser: string | null;
  onSelectUser: (user: string) => void;
  onGetUsers: () => void;
  onGetHistory: () => void;
  onDisconnect: () => void;
  isConnected: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({
  currentUser,
  onlineUsers,
  selectedUser,
  onSelectUser,
  onGetUsers,
  onGetHistory,
  onDisconnect,
  isConnected
}) => {
  const otherUsers = onlineUsers.filter(u => u !== currentUser);
  
  return (
    <div className="sidebar">
      <div className="user-info">
        <div className="user-avatar">👤</div>
        <div className="user-details">
          <div className="user-name">{currentUser || 'Not logged in'}</div>
          <div className="user-status">
            <span className={`status-dot ${isConnected ? 'online' : 'offline'}`}></span>
            {isConnected ? 'Connected' : 'Disconnected'}
          </div>
        </div>
        <button onClick={onDisconnect} className="logout-btn" title="Disconnect">
          ⏏️
        </button>
      </div>
      
      <div className="actions">
        <button onClick={onGetUsers} className="action-btn" disabled={!isConnected}>
          🔄 Refresh Users
        </button>
        <button onClick={onGetHistory} className="action-btn" disabled={!isConnected}>
          📜 Get History
        </button>
      </div>
      
      <div className="users-section">
        <div className="users-header">
          <h4>📋 Online Users</h4>
          <span className="users-count">{otherUsers.length}</span>
        </div>
        
        <div className="users-list">
          {otherUsers.length === 0 && (
            <div className="no-users">
              {!isConnected ? 'Not connected' : 'No other users online'}
            </div>
          )}
          {otherUsers.map(user => (
            <div
              key={user}
              className={`user-item ${selectedUser === user ? 'selected' : ''}`}
              onClick={() => onSelectUser(user)}
            >
              <span className="user-status-dot online"></span>
              <span className="user-name">{user}</span>
              {selectedUser === user && <span className="selected-indicator">✓</span>}
            </div>
          ))}
        </div>
        
        {currentUser && (
          <div className="current-user">
            <div className="user-item current">
              <span className="user-status-dot online"></span>
              <span className="user-name">{currentUser} (you)</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Sidebar;