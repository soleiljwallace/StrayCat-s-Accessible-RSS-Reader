package com.straycat.rssreader

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class ShareArgs {
    var title: String = ""
    var url: String = ""
}

@InvokeArg
class MediaArgs {
    var title: String = ""
    var artist: String = ""
    var playing: Boolean = false
    var stopped: Boolean = false
    var position: Long = 0   // milliseconds
    var duration: Long = 0   // milliseconds
    var speed: Float = 1f
}

/**
 * Android-only parts of the app:
 * - share: the system share sheet
 * - media: a media session, so earbud and headset buttons, the lock screen and
 *   the notification shade control the podcast player, plus audio focus so
 *   other apps pause while it plays
 * - pickFile: the system file picker, for importing feeds
 * - the back button, which always goes back one screen inside the app
 */
@TauriPlugin
class StrayPlugin(private val activity: Activity) : Plugin(activity) {
    private var webView: WebView? = null
    private var session: MediaSession? = null
    private var focusRequest: AudioFocusRequest? = null
    private var hasFocus = false
    private var pausedForTransientLoss = false
    private val audioManager by lazy { activity.getSystemService(Context.AUDIO_SERVICE) as AudioManager }
    private val notificationManager by lazy { activity.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager }

    private fun js(script: String) {
        activity.runOnUiThread { webView?.evaluateJavascript(script, null) }
    }

    private fun mediaAction(action: String, value: Long = -1) =
        js("window.__strayMedia && window.__strayMedia('$action', $value)")

    override fun load(webView: WebView) {
        super.load(webView)
        this.webView = webView
        activity.runOnUiThread {
            // Let earbud and lock screen buttons start playback (they aren't taps on the page).
            webView.settings.mediaPlaybackRequiresUserGesture = false
            (activity as? ComponentActivity)?.onBackPressedDispatcher?.addCallback(
                activity,
                object : OnBackPressedCallback(true) {
                    // Never close the app: hand the press to the page, which goes back one screen.
                    override fun handleOnBackPressed() = js("window.__strayBack && window.__strayBack()")
                }
            )
        }
    }

    // ---------------------------------------------------------------- share

    @Command
    fun share(invoke: Invoke) {
        val args = invoke.parseArgs(ShareArgs::class.java)
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, args.title)
            putExtra(Intent.EXTRA_TEXT, args.url)
        }
        activity.runOnUiThread { activity.startActivity(Intent.createChooser(send, null)) }
        invoke.resolve()
    }

    // ---------------------------------------------------------------- file picker

    @Command
    fun pickFile(invoke: Invoke) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
        }
        startActivityForResult(invoke, intent, "filePicked")
    }

    @ActivityCallback
    fun filePicked(invoke: Invoke, result: ActivityResult) {
        val uri = result.data?.data
        val ret = JSObject()
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            ret.put("cancelled", true)
            invoke.resolve(ret)
            return
        }
        try {
            val text = activity.contentResolver.openInputStream(uri)?.use { it.readBytes().toString(Charsets.UTF_8) } ?: ""
            ret.put("text", text)
            invoke.resolve(ret)
        } catch (e: Exception) {
            invoke.reject("Couldn't read that file: ${e.message}")
        }
    }

    // ---------------------------------------------------------------- media

    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        when (change) {
            AudioManager.AUDIOFOCUS_LOSS -> {
                hasFocus = false
                pausedForTransientLoss = false
                mediaAction("pause")
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                // A call or a navigation prompt: pause, and carry on afterwards.
                pausedForTransientLoss = true
                mediaAction("pause")
            }
            AudioManager.AUDIOFOCUS_GAIN -> {
                hasFocus = true
                if (pausedForTransientLoss) {
                    pausedForTransientLoss = false
                    mediaAction("play")
                }
            }
        }
    }

    private fun requestFocus() {
        if (hasFocus) return
        val granted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val req = focusRequest ?: AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                )
                .setOnAudioFocusChangeListener(focusListener)
                .build()
            focusRequest = req
            audioManager.requestAudioFocus(req)
        } else {
            @Suppress("DEPRECATION")
            audioManager.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
        }
        hasFocus = granted == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }

    private fun abandonFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
        } else {
            @Suppress("DEPRECATION")
            audioManager.abandonAudioFocus(focusListener)
        }
        hasFocus = false
    }

    private fun ensureSession(): MediaSession {
        session?.let { return it }
        val s = MediaSession(activity, "StrayCatRSS")
        s.setCallback(object : MediaSession.Callback() {
            override fun onPlay() = mediaAction("play")
            override fun onPause() = mediaAction("pause")
            override fun onStop() = mediaAction("pause")
            override fun onSkipToNext() = mediaAction("forward")
            override fun onSkipToPrevious() = mediaAction("back")
            override fun onFastForward() = mediaAction("forward")
            override fun onRewind() = mediaAction("back")
            override fun onSeekTo(pos: Long) = mediaAction("seek", pos)
        })
        session = s
        return s
    }

    private fun showNotification(s: MediaSession, args: MediaArgs) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            notificationManager.createNotificationChannel(
                NotificationChannel("playback", "Podcast playback", NotificationManager.IMPORTANCE_LOW)
            )
        }
        val open = activity.packageManager.getLaunchIntentForPackage(activity.packageName)
        val contentIntent = PendingIntent.getActivity(
            activity, 0, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(activity, "playback")
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(activity)
        }
        val notification = builder
            .setSmallIcon(activity.applicationInfo.icon)
            .setContentTitle(args.title)
            .setContentText(args.artist)
            .setContentIntent(contentIntent)
            .setOngoing(args.playing)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setStyle(Notification.MediaStyle().setMediaSession(s.sessionToken))
            .build()
        try {
            notificationManager.notify(NOTIFICATION_ID, notification)
        } catch (e: SecurityException) {
            // Notifications turned off for the app; buttons still work through the session.
        }
    }

    @Command
    fun media(invoke: Invoke) {
        val args = invoke.parseArgs(MediaArgs::class.java)
        activity.runOnUiThread {
            if (args.stopped) {
                session?.isActive = false
                notificationManager.cancel(NOTIFICATION_ID)
                abandonFocus()
                return@runOnUiThread
            }
            val s = ensureSession()
            s.setMetadata(
                MediaMetadata.Builder()
                    .putString(MediaMetadata.METADATA_KEY_TITLE, args.title)
                    .putString(MediaMetadata.METADATA_KEY_ARTIST, args.artist)
                    .putLong(MediaMetadata.METADATA_KEY_DURATION, args.duration)
                    .build()
            )
            s.setPlaybackState(
                PlaybackState.Builder()
                    .setActions(
                        PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or
                            PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS or
                            PlaybackState.ACTION_FAST_FORWARD or PlaybackState.ACTION_REWIND or
                            PlaybackState.ACTION_SEEK_TO or PlaybackState.ACTION_STOP
                    )
                    .setState(
                        if (args.playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED,
                        args.position,
                        if (args.playing) args.speed else 0f
                    )
                    .build()
            )
            // Stays active while paused, so the earbud's play button comes back to this app.
            s.isActive = true
            if (args.playing) requestFocus()
            showNotification(s, args)
        }
        invoke.resolve()
    }

    companion object {
        private const val NOTIFICATION_ID = 4242
    }
}
