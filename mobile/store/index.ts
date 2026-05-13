import { configureStore, createListenerMiddleware } from '@reduxjs/toolkit';
import * as SecureStore from 'expo-secure-store';
import { TypedUseSelectorHook, useDispatch, useSelector } from 'react-redux';
import authReducer, { logout, setAuth } from './authSlice';
import { TOKEN_KEY } from '../services/api';

const listenerMiddleware = createListenerMiddleware();

listenerMiddleware.startListening({
  actionCreator: setAuth,
  effect: async (action) => {
    await SecureStore.setItemAsync(TOKEN_KEY, action.payload.token);
  },
});

listenerMiddleware.startListening({
  actionCreator: logout,
  effect: async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  },
});

export const store = configureStore({
  reducer: {
    auth: authReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
    }).prepend(listenerMiddleware.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;