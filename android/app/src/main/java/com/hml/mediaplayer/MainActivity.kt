package com.hml.mediaplayer

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.ViewModelProvider
import com.hml.mediaplayer.ui.HmlApp
import com.hml.mediaplayer.viewmodel.PlayerViewModel

class MainActivity : ComponentActivity() {
    private lateinit var viewModel: PlayerViewModel

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        viewModel = ViewModelProvider(this)[PlayerViewModel::class.java]
        setContent {
            HmlApp(viewModel = viewModel)
        }
    }
}
