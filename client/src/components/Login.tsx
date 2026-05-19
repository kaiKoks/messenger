import React, { useState } from 'react';

interface LoginProps {
  onLogin: (username: string, password: string) => void;
  onRegister: (username: string, password: string) => void;
  error: string | null;
  isLoading: boolean;
}

const Login: React.FC<LoginProps> = ({ onLogin, onRegister, error, isLoading }) => {
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    
    if (isLoginMode) {
      onLogin(username, password);
    } else {
      onRegister(username, password);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <h1>📱 Мессенджер</h1>
        <p className="login-subtitle">
          {isLoginMode ? 'Войдите в свой аккаунт' : 'Создайте новый аккаунт'}
        </p>
        
        <div className="login-tabs">
          <button 
            type="button"
            className={isLoginMode ? 'active' : ''} 
            onClick={() => setIsLoginMode(true)}
          >
            Войти
          </button>
          <button 
            type="button"
            className={!isLoginMode ? 'active' : ''} 
            onClick={() => setIsLoginMode(false)}
          >
            Регистрация
          </button>
        </div>
        
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Имя пользователя"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={isLoading}
            autoFocus
          />
          <input
            type="password"
            placeholder="Пароль"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isLoading}
          />
          
          <button type="submit" disabled={!username || !password || isLoading}>
            {isLoading ? 'Загрузка...' : (isLoginMode ? 'Войти →' : 'Зарегистрироваться →')}
          </button>
        </form>
        
        {error && <div className="error-message">{error}</div>}
      </div>
    </div>
  );
};

export default Login;