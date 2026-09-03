<script>
import { appLifecycle } from './analytics'

export default {
  onLaunch(options) {
    appLifecycle.onLaunch(options)
  },
  onShow(options) {
    appLifecycle.onShow(options)
  },
  onHide() {
    appLifecycle.onHide()
  },
}
</script>

<style>
page {
  background: #f7f8fa;
}
</style>
