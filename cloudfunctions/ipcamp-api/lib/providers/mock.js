class MockProvider {
  async create() {
    return { providerTaskId: `mock_${Date.now()}`, rawState: 'created' }
  }

  async query() {
    return { status: 'processing', progress: 50 }
  }
}

module.exports = { MockProvider }
