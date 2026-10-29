package id.bpn.petaku;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PetakuPlugin.class);
        super.onCreate(savedInstanceState);
        PetakuPlugin.handleIntent(this, getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        PetakuPlugin.handleIntent(this, intent);
    }
}
