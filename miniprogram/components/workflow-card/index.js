Component({
  properties: {
    workflow: {
      type: Object,
      value: {}
    }
  },

  methods: {
    handleTap() {
      this.triggerEvent('select', { id: this.data.workflow.id })
    }
  }
})
