import { useState } from 'react';
import Login from './Login';
import Register from './Register';

export default function AuthPage() {
  const [showLogin, setShowLogin] = useState(true);

  return showLogin ? (
    <Login onSwitchToRegister={() => setShowLogin(false)} />
  ) : (
    <Register onSwitchToLogin={() => setShowLogin(true)} />
  );
}
