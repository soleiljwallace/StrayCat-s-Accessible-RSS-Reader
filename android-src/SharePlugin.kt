package com.straycat.rssreader

import android.app.Activity
import android.content.Intent
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
class ShareArgs {
    var title: String = ""
    var url: String = ""
}

/** Opens Android's share sheet for an article link. */
@TauriPlugin
class SharePlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun share(invoke: Invoke) {
        val args = invoke.parseArgs(ShareArgs::class.java)
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, args.title)
            putExtra(Intent.EXTRA_TEXT, args.url)
        }
        activity.runOnUiThread {
            activity.startActivity(Intent.createChooser(send, null))
        }
        invoke.resolve()
    }
}
