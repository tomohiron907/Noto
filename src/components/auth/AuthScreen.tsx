import { useAuthStore } from "../../stores/authStore";

export default function AuthScreen() {
  const { signIn, loading, error } = useAuthStore();

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-gray-50 dark:bg-gray-950">
      <div className="flex flex-col items-center gap-6 p-10 rounded-2xl bg-white dark:bg-gray-900 shadow-lg w-80">
        <div className="flex flex-col items-center gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
            Noto
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Markdown notes on Google Drive
          </p>
        </div>

        <button
          onClick={signIn}
          disabled={loading}
          className="flex items-center gap-3 w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <GoogleIcon />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {loading ? "Signing in…" : "Sign in with Google"}
          </span>
        </button>

        {error && (
          <p className="text-xs text-red-500 text-center">{error}</p>
        )}
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  );
}
