import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import AuthPage from './pages/AuthPage';
import DashboardPage from './pages/DashboardPage';
import MeetingPage from './pages/MeetingPage';
import UploadPage from './pages/UploadPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/register" element={<AuthPage mode="register" />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/meetings/:id" element={<MeetingPage />} />
        </Route>
      </Route>
      <Route path="*" element={<p className="p-6">Page not found.</p>} />
    </Routes>
  );
}
