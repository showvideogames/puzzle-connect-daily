/** Only the header's auth subscription exists. No live client or credentials. */
export const supabase = {
  auth: {
    getSession: async () => ({ data: { session: { user: { id: 'fixture', email: 'preview@example.test' } } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
};
