import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider, CssBaseline } from '@mui/material'
import { theme } from './theme/theme'
import { SessionProvider } from './context/SessionContext'
import { AppRouter } from './router/AppRouter'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <SessionProvider>
          <AppRouter />
        </SessionProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
