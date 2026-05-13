import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export type User = Record<string, unknown> | null;

export type AuthState = {
  user: User;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
};

const initialState: AuthState = {
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setAuth(
      state,
      action: PayloadAction<{
          user: User;
          token: string;
          isAuthenticated?: boolean;
        }>
    ) {
      state.user = action.payload.user;
      state.token = action.payload.token;
        state.isAuthenticated = action.payload.isAuthenticated ?? true;
      state.error = null;
    },
    logout(state) {
      state.user = null;
      state.token = null;
      state.isAuthenticated = false;
      state.error = null;
    },
    setLoading(state, action: PayloadAction<boolean>) {
      state.isLoading = action.payload;
    },
    setError(state, action: PayloadAction<string | null>) {
      state.error = action.payload;
    },
  },
});

export const { setAuth, logout, setLoading, setError } = authSlice.actions;
export default authSlice.reducer;