import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import Layout from './components/Layout';
import { Spinner } from './components/State';
import LoginPage from './pages/Login';
import ReposPage from './pages/Repos';
import RepoPage from './pages/Repo';
import NewRepoPage from './pages/NewRepo';
import SearchPage from './pages/Search';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

function RequireAuth() {
  const { token, booting } = useAuth();

  if (booting) {
    return (
      <div className="boot-screen">
        <Spinner label="正在验证 Token…" />
      </div>
    );
  }

  if (!token) return <Navigate to="/login" replace />;
  return <Layout />;
}

function NotFound() {
  return (
    <div className="boot-screen">
      <div className="state-box">
        <div className="state-icon" aria-hidden="true">
          404
        </div>
        <div>
          <h3>页面不存在</h3>
          <p className="muted">
            回到 <a href="/">仓库列表</a>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<RequireAuth />}>
              <Route path="/" element={<ReposPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/new" element={<NewRepoPage />} />
              <Route path="/r/:owner/:repo" element={<RepoPage />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
