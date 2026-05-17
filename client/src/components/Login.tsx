import React, { useState } from 'react';

interface LoginProps {
  onConnect: (username: string) => void;
  error: string | null;
}

const Login: React.FC<LoginProps> = ({ onConnect, error }) => {
  const [username, setUsername] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim() && !isConnecting) {
      setIsConnecting(true);
      onConnect(username.trim());
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <h1>📱 Messenger</h1>
        <p className="login-subtitle">Connect to the server and start chatting</p>
        
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Enter your username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={isConnecting}
            autoFocus
          />
          <button type="submit" disabled={!username.trim() || isConnecting}>
            {isConnecting ? 'Connecting...' : 'Connect →'}
          </button>
        </form>
        
        {error && <div className="error-message">{error}</div>}
        
        <div className="login-info">
          <small>Server: ws://localhost:8080</small>
        </div>
      </div>
    </div>
  );
};

export default Login;