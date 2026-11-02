import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, RequireAuth } from './auth/AuthContext';
import { ForgotPasswordPage, LoginPage, RegisterPage } from './auth/AuthPages';
import ConsoleApp from './console/ConsoleApp';
import { ProductRoot, ProductLayout } from './product/ProductChrome';
import { HomePage } from './product/HomePage';
import { ChatPage } from './product/ChatPage';
import { ActivityPage } from './product/ActivityPage';
import { CardsPage } from './product/CardsPage';
import { ProfilePage } from './product/ProfilePage';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route
            path="/console"
            element={
              <RequireAuth>
                <ConsoleApp />
              </RequireAuth>
            }
          />
          <Route
            path="/app"
            element={
              <RequireAuth>
                <ProductRoot />
              </RequireAuth>
            }
          >
            <Route element={<ProductLayout />}>
              <Route index element={<HomePage />} />
              <Route path="activity" element={<ActivityPage />} />
              <Route path="cards" element={<CardsPage />} />
              <Route path="profile" element={<ProfilePage />} />
            </Route>
            <Route path="chat" element={<ChatPage />} />
          </Route>
          <Route path="/" element={<Navigate to="/app" replace />} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
